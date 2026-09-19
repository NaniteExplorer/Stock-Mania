(function () {
  const tabs = Array.from(document.querySelectorAll('[role="tab"]'));
  const panels = Array.from(document.querySelectorAll('[role="tabpanel"]'));

  function activateTab(tab) {
    tabs.forEach((item) => item.setAttribute('aria-selected', String(item === tab)));
    panels.forEach((panel) => { panel.hidden = panel.id !== tab.dataset.panel; });
  }

  tabs.forEach((tab, index) => {
    tab.addEventListener('click', () => activateTab(tab));
    tab.addEventListener('keydown', (event) => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      event.preventDefault();
      const offset = event.key === 'ArrowRight' ? 1 : -1;
      const next = tabs[(index + offset + tabs.length) % tabs.length];
      activateTab(next);
      next.focus();
    });
  });

  document.querySelectorAll('.holding-trigger').forEach((trigger) => {
    trigger.addEventListener('click', () => {
      document.querySelectorAll('.holding-detail').forEach((detail) => { detail.hidden = detail.id !== trigger.dataset.detail; });
      const selected = document.getElementById(trigger.dataset.detail);
      selected.scrollIntoView({ behavior: 'smooth', block: 'start' });
      selected.setAttribute('tabindex', '-1');
      selected.focus({ preventScroll: true });
    });
  });
}());
