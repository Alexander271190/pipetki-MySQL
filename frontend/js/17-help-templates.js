'use strict';

// ============================================================
// ШАБЛОНЫ НОВЫХ ЕДИНИЦ
// ============================================================
let _cachedEquipmentTemplates = [];

async function loadEquipmentTemplates() {
  const bar = document.getElementById('template-bar');
  const sel = document.getElementById('template-select');
  if (!bar || !sel) return;

  if (!isAdmin()) {
    bar.style.display = 'none';
    return;
  }

  bar.style.display = 'flex';
  sel.innerHTML = '<option value="">— без шаблона —</option>';

  try {
    _cachedEquipmentTemplates = await apiRequest('/equipment-templates');
    for (const tpl of _cachedEquipmentTemplates) {
      const opt = document.createElement('option');
      opt.value = String(tpl.id);
      opt.textContent = tpl.name;
      sel.appendChild(opt);
    }
  } catch (e) {
    console.error('loadEquipmentTemplates:', e);
  }
}

async function applyEquipmentTemplate(templateId) {
  if (!templateId) return;
  const tpl = _cachedEquipmentTemplates.find(t => String(t.id) === String(templateId));
  if (!tpl) { showToast('Шаблон не найден', 'error'); return; }

  const data = tpl.data || {};
  let applied = 0;

  for (const [fieldId, value] of Object.entries(data)) {
    const input = document.querySelector(`[data-field-id="${fieldId}"]`);
    if (!input) continue;
    if (value === undefined || value === null || value === '') continue;

    if (input.tagName === 'SELECT') {
      const hasOption = [...input.options].some(o => String(o.value) === String(value));
      if (hasOption) {
        input.value = String(value);
        applied++;
      }
    } else {
      input.value = String(value);
      applied++;
    }
  }

  const eqSelect = document.getElementById('p-equipmentType');
  if (eqSelect && applied > 0) {
    eqSelect.dispatchEvent(new Event('change'));
  }

  showToast(`Применено полей: ${applied}`, 'success');
}

async function saveAsTemplate() {
  if (!isAdmin()) { showToast('Только админ может создавать шаблоны', 'error'); return; }

  const name = prompt('Название шаблона (например «Eppendorf Research Plus 1000 мкл»):');
  if (!name || !name.trim()) return;

  const data = {};
  document.querySelectorAll('#form-fields-container [data-field-id]').forEach(el => {
    const fieldId = el.dataset.fieldId;
    if (['id', 'barcode', 'responsible', 'location'].includes(fieldId)) return;

    const value = el.value;
    if (value === undefined || value === null || value === '') return;
    data[fieldId] = value;
  });

  if (Object.keys(data).length === 0) {
    showToast('Заполните хотя бы одно поле', 'error');
    return;
  }

  try {
    await apiRequest('/equipment-templates', 'POST', { name: name.trim(), data });
    showToast('Шаблон сохранён', 'success');
    await loadEquipmentTemplates();

    const sel = document.getElementById('template-select');
    const newTpl = _cachedEquipmentTemplates.find(t => t.name === name.trim());
    if (newTpl && sel) sel.value = String(newTpl.id);
  } catch (e) {
    showToast(e.message || 'Ошибка сохранения', 'error');
  }
}