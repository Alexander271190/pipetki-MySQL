'use strict';
const { pool } = require('./pool');

// ============================================================
// Универсальный догон колонок
// ============================================================
async function ensureColumns(conn, table, columns) {
  const [tableExists] = await conn.query(`
    SELECT COUNT(*) AS c FROM information_schema.TABLES
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?
  `, [table]);
  if (tableExists[0].c === 0) return;

  const [existing] = await conn.query(`
    SELECT COLUMN_NAME FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?
  `, [table]);
  const existingNames = new Set(existing.map(r => r.COLUMN_NAME));

  for (const { name, ddl } of columns) {
    if (existingNames.has(name)) continue;
    try {
      await conn.query(`ALTER TABLE \`${table}\` ADD COLUMN \`${name}\` ${ddl}`);
      console.log(`➕ ${table}.${name} добавлена`);
    } catch (e) {
      if (e.code !== 'ER_DUP_FIELDNAME') {
        console.error(`❌ Не удалось добавить ${table}.${name}:`, e.message);
      }
    }
  }
}

// ============================================================
// Универсальный догон индексов
// ============================================================
async function ensureIndexes(conn, table, indexes) {
  const [tableExists] = await conn.query(`
    SELECT COUNT(*) AS c FROM information_schema.TABLES
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?
  `, [table]);
  if (tableExists[0].c === 0) return;

  const [existing] = await conn.query(`
    SELECT INDEX_NAME FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?
  `, [table]);
  const existingNames = new Set(existing.map(r => r.INDEX_NAME));

  for (const { name, ddl } of indexes) {
    if (existingNames.has(name)) continue;
    try {
      await conn.query(ddl);
      console.log(`➕ Индекс ${table}.${name} создан`);
    } catch (e) {
      if (e.code !== 'ER_DUP_KEYNAME') {
        console.error(`❌ Не удалось создать индекс ${table}.${name}:`, e.message);
      }
    }
  }
}

// ============================================================
// СХЕМА
// ============================================================
async function initSchema() {
  const conn = await pool.getConnection();
  try {
    await conn.query(`
      CREATE TABLE IF NOT EXISTS users (
        id VARCHAR(255) PRIMARY KEY,
        login VARCHAR(255) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        full_name VARCHAR(255) NOT NULL,
        position VARCHAR(255) NOT NULL,
        department VARCHAR(255),
        role VARCHAR(50) DEFAULT 'user',
        extra_permissions TEXT,
        only_own_department TINYINT DEFAULT 0,
        is_acting TINYINT DEFAULT 0,
        acting_for_id VARCHAR(255) DEFAULT NULL,
        must_change_password TINYINT DEFAULT 0,
        must_set_password TINYINT DEFAULT 0,
        password_changed_at TIMESTAMP NULL DEFAULT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS pipettes (
        id VARCHAR(255) PRIMARY KEY,
        serial VARCHAR(255),
        manufacturer VARCHAR(255),
        model VARCHAR(255) NOT NULL,
        equipment_type VARCHAR(50) DEFAULT 'pipette',
        volume VARCHAR(50),
        department VARCHAR(255),
        \`interval\` INT DEFAULT 12,
        last_calibration VARCHAR(20),
        cert VARCHAR(255),
        last_result VARCHAR(20) DEFAULT 'pass',
        active TINYINT DEFAULT 1,
        responsible VARCHAR(255),
        location VARCHAR(255),
        notes TEXT,
        sent_for_calibration VARCHAR(20),
        sent_note TEXT,
        replaced_by VARCHAR(255) DEFAULT NULL,
        replacing VARCHAR(255) DEFAULT NULL,
        custom_data JSON DEFAULT NULL,
        barcode        VARCHAR(255) DEFAULT NULL,
        barcode_source VARCHAR(50)  DEFAULT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    
    await conn.query(`
      CREATE TABLE IF NOT EXISTS edit_locks (
        pipette_id VARCHAR(255) PRIMARY KEY,
        user_id VARCHAR(255) NOT NULL,
        user_full_name VARCHAR(255) NOT NULL,
        locked_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (pipette_id) REFERENCES pipettes(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    
    await conn.query(`
      CREATE TABLE IF NOT EXISTS calibration_history (
        id INT AUTO_INCREMENT PRIMARY KEY,
        pipette_id VARCHAR(255) NOT NULL,
        \`date\` VARCHAR(20) NOT NULL,
        cert VARCHAR(255),
        result VARCHAR(20) DEFAULT 'pass',
        org VARCHAR(255),
        note TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (pipette_id) REFERENCES pipettes(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS app_logs (
        id INT AUTO_INCREMENT PRIMARY KEY,
        level VARCHAR(20) NOT NULL DEFAULT 'error',
        source VARCHAR(50) DEFAULT NULL,
        message TEXT NOT NULL,
        stack TEXT,
        user_id VARCHAR(255) DEFAULT NULL,
        user_full_name VARCHAR(255) DEFAULT NULL,
        method VARCHAR(10) DEFAULT NULL,
        url VARCHAR(500) DEFAULT NULL,
        status_code INT DEFAULT NULL,
        ip VARCHAR(64) DEFAULT NULL,
        timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_app_logs_ts (timestamp),
        INDEX idx_app_logs_level (level)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS permission_presets (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(100) NOT NULL UNIQUE,
        permissions JSON NOT NULL,
        created_by VARCHAR(255) DEFAULT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS audit_log (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id VARCHAR(255) NOT NULL,
        user_full_name VARCHAR(255) NOT NULL,
        action VARCHAR(255) NOT NULL,
        details TEXT,
        timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS departments (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(255) UNIQUE NOT NULL,
        enabled TINYINT DEFAULT 1,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS filter_config (
        id VARCHAR(100) PRIMARY KEY,
        label VARCHAR(255) NOT NULL,
        type VARCHAR(50) NOT NULL,
        field_id VARCHAR(100),
        enabled TINYINT DEFAULT 1,
        options_source VARCHAR(100),
        filter_order INT DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS system_settings (
        setting_key VARCHAR(100) PRIMARY KEY,
        setting_value TEXT,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS field_config (
        id VARCHAR(100) PRIMARY KEY,
        label VARCHAR(255) NOT NULL,
        type VARCHAR(50) NOT NULL,
        required TINYINT DEFAULT 0,
        enabled TINYINT DEFAULT 1,
        options TEXT,
        default_value TEXT,
        field_order INT DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS export_settings (
        id INT PRIMARY KEY,
        fields TEXT NOT NULL,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS user_preferences (
        user_id VARCHAR(255) PRIMARY KEY,
        preferences TEXT,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS barcode_printers (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        department VARCHAR(255) DEFAULT NULL,
        mode VARCHAR(30) NOT NULL DEFAULT 'pdf-zebra',
        ip VARCHAR(45) DEFAULT NULL,
        port INT DEFAULT 9100,
        label_size VARCHAR(20) DEFAULT '58x40',
        enabled TINYINT DEFAULT 1,
        is_default TINYINT DEFAULT 0,
        sort_order INT DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_barcode_printers_department (department),
        INDEX idx_barcode_printers_enabled (enabled)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // 🆕 Справка (ДОБАВЛЕНО file_path)
    await conn.query(`
      CREATE TABLE IF NOT EXISTS help_docs (
        id INT AUTO_INCREMENT PRIMARY KEY,
        slug VARCHAR(100) NOT NULL UNIQUE,
        title VARCHAR(255) NOT NULL,
        content MEDIUMTEXT NULL DEFAULT NULL,
        file_path VARCHAR(255) DEFAULT NULL,
        required_permissions TEXT,
        sort_order INT DEFAULT 0,
        enabled TINYINT DEFAULT 1,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_help_enabled (enabled),
        INDEX idx_help_sort (sort_order)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS help_images (
        id INT AUTO_INCREMENT PRIMARY KEY,
        filename VARCHAR(255) NOT NULL,
        original_name VARCHAR(255),
        mime_type VARCHAR(100) NOT NULL,
        size_bytes INT DEFAULT 0,
        uploaded_by VARCHAR(255),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // 🆕 Шаблоны вида
    await conn.query(`
      CREATE TABLE IF NOT EXISTS view_templates (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(150) NOT NULL UNIQUE,
        visible_fields JSON NOT NULL,
        is_default TINYINT DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_vt_default (is_default)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // 🆕 Шаблоны единиц оборудования
    await conn.query(`
      CREATE TABLE IF NOT EXISTS equipment_templates (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(150) NOT NULL UNIQUE,
        data JSON NOT NULL,
        created_by VARCHAR(255),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_et_name (name)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // 🆕 Догон колонок
    await ensureColumns(conn, 'users', [
      { name: 'is_acting',           ddl: 'TINYINT DEFAULT 0' },
      { name: 'acting_for_id',       ddl: 'VARCHAR(255) DEFAULT NULL' },
      { name: 'password_changed_at', ddl: 'TIMESTAMP NULL DEFAULT NULL' },
      { name: 'only_own_department', ddl: 'TINYINT DEFAULT 0' },
      { name: 'must_set_password',   ddl: 'TINYINT DEFAULT 0' },
      { name: 'view_template_id',    ddl: 'INT NULL DEFAULT NULL' },
    ]);
    
    await ensureColumns(conn, 'help_docs', [
      { name: 'file_path', ddl: 'VARCHAR(255) DEFAULT NULL' }
    ]);

    await ensureColumns(conn, 'audit_log', [
      { name: 'pipette_id', ddl: 'VARCHAR(255) DEFAULT NULL' },
      { name: 'category',   ddl: 'VARCHAR(50) DEFAULT NULL' }
    ]);

    try {
      await conn.query('CREATE INDEX idx_audit_pipette ON audit_log(pipette_id)');
    } catch (e) {}
    try {
      await conn.query('CREATE INDEX idx_audit_category ON audit_log(category)');
    } catch (e) {}

    await ensureColumns(conn, 'pipettes', [
      { name: 'custom_data',          ddl: 'JSON DEFAULT NULL' },
      { name: 'replaced_by',          ddl: 'VARCHAR(255) DEFAULT NULL' },
      { name: 'replacing',            ddl: 'VARCHAR(255) DEFAULT NULL' },
      { name: 'sent_for_calibration', ddl: 'VARCHAR(20)' },
      { name: 'sent_note',            ddl: 'TEXT' },
      { name: 'barcode',              ddl: 'VARCHAR(255) DEFAULT NULL' },
      { name: 'barcode_source',       ddl: 'VARCHAR(50) DEFAULT NULL' },
    ]);

   // 🆕 Догон индексов
    await ensureIndexes(conn, 'pipettes', [
      { name: 'idx_pipettes_department',     ddl: 'CREATE INDEX idx_pipettes_department ON pipettes(department)' },
      { name: 'idx_pipettes_equipment_type', ddl: 'CREATE INDEX idx_pipettes_equipment_type ON pipettes(equipment_type)' },
      { name: 'idx_pipettes_barcode',        ddl: 'CREATE INDEX idx_pipettes_barcode ON pipettes(barcode)' },
      { name: 'idx_pipettes_last_calibration', ddl: 'CREATE INDEX idx_pipettes_last_calibration ON pipettes(last_calibration)' },
      { name: 'idx_pipettes_active',          ddl: 'CREATE INDEX idx_pipettes_active ON pipettes(active)' },
      { name: 'idx_pipettes_sent_for_calibration', ddl: 'CREATE INDEX idx_pipettes_sent_for_calibration ON pipettes(sent_for_calibration)' },
    ]);

    await ensureIndexes(conn, 'audit_log', [
      { name: 'idx_audit_log_timestamp', ddl: 'CREATE INDEX idx_audit_log_timestamp ON audit_log(timestamp DESC)' },
    ]);

    // === Идемпотентное выравнивание длины barcode на существующих БД ===
    const [barcodeCol] = await conn.query(`
      SELECT CHARACTER_MAXIMUM_LENGTH AS len FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'pipettes' AND COLUMN_NAME = 'barcode'
    `);
    if (!barcodeCol.length || barcodeCol[0].len !== 255) {
      await conn.query('ALTER TABLE pipettes MODIFY COLUMN barcode VARCHAR(255) NULL DEFAULT NULL');
    }

    const [barcodeSrcCol] = await conn.query(`
      SELECT CHARACTER_MAXIMUM_LENGTH AS len FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'pipettes' AND COLUMN_NAME = 'barcode_source'
    `);
    if (!barcodeSrcCol.length || barcodeSrcCol[0].len !== 50) {
      await conn.query('ALTER TABLE pipettes MODIFY COLUMN barcode_source VARCHAR(50) NULL DEFAULT NULL');
    }
    
  } finally {
    conn.release();
  }

  return true;
}

module.exports = { initSchema, ensureColumns, ensureIndexes };
