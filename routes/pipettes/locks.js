'use strict';
const express = require('express');
const router = express.Router();
const db = require('../../db');
const { authenticate } = require('../../middleware/auth');
const { logAction } = require('../../utils/audit');

router.get('/:id/lock', authenticate, async (req, res) => {
  try {
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
      lockedByPosition: position
    });
  } catch (e) { 
    console.error('GET /lock error:', e); 
    res.status(500).json({ error: 'Ошибка проверки' }); 
  }
});

router.post('/:id/lock', authenticate, async (req, res) => {
  try {
    const [ex] = await db.query('SELECT * FROM edit_locks WHERE pipette_id = ?', [req.params.id]);
    if (ex.length > 0) {
      if (ex[0].user_id === req.user.id) {
        await db.query('UPDATE edit_locks SET locked_at = CURRENT_TIMESTAMP WHERE pipette_id = ?', [req.params.id]);
        return res.json({ locked: true, mine: true });
      }
      return res.status(409).json({ error: 'Заблокировано', lockedBy: ex[0].user_full_name });
    }
    await db.query('INSERT INTO edit_locks (pipette_id, user_id, user_full_name) VALUES (?, ?, ?)', [req.params.id, req.user.id, req.user.full_name]);
    res.json({ locked: true, mine: true });
  } catch (e) { 
    console.error('POST /lock error:', e); 
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
