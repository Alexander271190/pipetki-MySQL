'use strict';
const express = require('express');
const router = express.Router();
const db = require('../../db');
const { authenticate } = require('../../middleware/auth');
const { logAction } = require('../../utils/audit');

router.get('/:id/lock', authenticate, async (req, res) => {
  try {
    await db.query('DELETE FROM edit_locks WHERE locked_at < DATE_SUB(NOW(), INTERVAL 30 MINUTE)');

    const [rows] = await db.query(`
      SELECT l.*, u.position AS actual_position 
      FROM edit_locks l
      LEFT JOIN users u ON u.id = l.user_id
      WHERE l.pipette_id = ?
    `, [req.params.id]);
    
    if (!rows.length) return res.json({ locked: false });
    const lock = rows[0];
    if (lock.user_id === req.user.id) return res.json({ locked: true, mine: true });
        
    const position = lock.actual_position || lock.user_position || '';
    
        res.json({ 
      locked: true, 
      mine: false, 
      lockedBy: lock.user_full_name,
      lockedByPosition: position,
      pipetteId: req.params.id 
    });
    
  } catch (e) { 
    console.error('GET /lock error:', e); 
    res.status(500).json({ error: 'Ошибка проверки' }); 
  }
});

router.post('/:id/lock', authenticate, async (req, res) => {
  try {
    // 1. Пытаемся обновить время, если блокировка уже наша
    const [updateRes] = await db.query(
      'UPDATE edit_locks SET locked_at = CURRENT_TIMESTAMP WHERE pipette_id = ? AND user_id = ?',
      [req.params.id, req.user.id]
    );
    
    if (updateRes.affectedRows > 0) {
      return res.json({ locked: true, mine: true });
    }

    // 2. Если не наша, пробуем вставить (если записи нет вообще)
    // INSERT IGNORE не вызывает ошибку, если ключ уже существует
    const [insertRes] = await db.query(
      'INSERT IGNORE INTO edit_locks (pipette_id, user_id, user_full_name) VALUES (?, ?, ?)',
      [req.params.id, req.user.id, req.user.full_name]
    );

    if (insertRes.affectedRows > 0) {
      return res.json({ locked: true, mine: true });
    }

    // 3. Если вставить не удалось, значит блокировка чужая
    const [rows] = await db.query('SELECT user_id, user_full_name FROM edit_locks WHERE pipette_id = ?', [req.params.id]);
    if (!rows.length) {
      return res.status(500).json({ error: 'Не удалось установить блокировку' });
    }
    
    const lock = rows[0];
    if (lock.user_id === req.user.id) {
      return res.json({ locked: true, mine: true });
    } else {
      return res.status(409).json({ error: 'Заблокировано', lockedBy: lock.user_full_name });
    }
    } catch (e) {
    console.error('POST /lock error:', e);
    if (e.code === 'ER_NO_REFERENCED_ROW_2') {
      return res.status(404).json({ error: 'Оборудование не найдено' });
    }
    if (e.code === 'ER_LOCK_DEADLOCK' || e.code === 'ER_LOCK_WAIT_TIMEOUT') {
      return res.status(429).json({ error: 'База данных занята, попробуйте еще раз' });
    }
    res.status(500).json({ error: 'Ошибка установки' });
  }
});

router.delete('/:id/lock', authenticate, async (req, res) => {
  try {
    const [ex] = await db.query('SELECT user_id, user_full_name FROM edit_locks WHERE pipette_id = ?', [req.params.id]);
    if (!ex.length) return res.json({ message: 'Нет блокировки' });
    await db.query('DELETE FROM edit_locks WHERE pipette_id = ?', [req.params.id]);
    if (ex[0].user_id !== req.user.id) {
      await logAction(req, 'Снятие блокировки', `Снята блокировка с ${req.params.id} (был: ${ex[0].user_full_name})`);
    }
    res.json({ message: 'Снята' });
  } catch (e) { 
    console.error('DELETE /lock error:', e); 
    res.status(500).json({ error: 'Ошибка снятия' }); 
  }
});
module.exports = router;
