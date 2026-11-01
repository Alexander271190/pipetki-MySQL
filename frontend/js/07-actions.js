async function deletePipette(id) {
  await refreshCurrentUser();
  if (!canManagePipettes()) { showToast('Доступ запрещён', 'error'); return; }

  try {
    // 1. Проверяем лок
    const lockRes = await apiRequest(`/pipettes/${id}/lock`);
    if (lockRes.locked && !lockRes.mine) {
      const proceed = await showLockWarning(lockRes, 'Удаление оборудования');
      if (!proceed) return;
    }
  } catch (e) {
    showToast('Ошибка проверки блокировки', 'error');
    return;
  }

  // 2. 🆕 ПОЛУЧАЕМ СВЕЖИЕ ДАННЫЕ С СЕРВЕРА (чтобы не полагаться на кэш браузера)
  let freshP = null;
  try {
    freshP = await apiRequest(`/pipettes/${encodeURIComponent(id)}`);
  } catch (e) {
    // Если 404, сервер сам отдаст ошибку при DELETE
  }

  // 3. Превентивная проверка по СВЕЖИМ данным
  if (freshP) {
    if (freshP.sent_for_calibration) {
      showToast(
        `Нельзя удалить ${freshP.id}: прибор отправлен на поверку` +
        (freshP.replaced_by ? `, замена: ${freshP.replaced_by}` : '') +
        `. Сначала отмените отправку или оформите возврат.`,
        'error'
      );
      apiRequest(`/pipettes/${id}/lock`, 'DELETE').catch(() => {});
      return;
    }
    if (freshP.replacing) {
      showToast(
        `Нельзя удалить ${freshP.id}: прибор используется как замена для ${freshP.replacing}. ` +
        `Сначала оформите возврат оригинала с поверки.`,
        'error'
      );
      apiRequest(`/pipettes/${id}/lock`, 'DELETE').catch(() => {});
      return;
    }
  }

  // 4. Если проверки пройдены — показываем окно
  const ok = await showConfirm(
    `Удалить оборудование «${id}» вместе со всей историей поверок? Действие необратимо.`,
    { icon: '🗑️', title: 'Удаление', okText: 'Удалить', okClass: 'btn-danger' }
  );
  if (!ok) {
    apiRequest(`/pipettes/${id}/lock`, 'DELETE').catch(() => {});
    return;
  }

  try {
    await apiRequest(`/pipettes/${id}`, 'DELETE');
    showToast('Оборудование удалено', 'success');
    selectedPipettes.delete(id);
    await loadPipetteData();
    await loadStats();
  } catch (error) {
    showToast(error.message || 'Ошибка удаления', 'error');
  }
}
