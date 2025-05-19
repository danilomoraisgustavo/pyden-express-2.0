document.addEventListener('DOMContentLoaded', () => {
    const html = document.documentElement;
    const sw = document.getElementById('themeSwitch');
    // Aplica tema salvo ou light por padrão
    const saved = localStorage.getItem('theme') || 'light';
    html.setAttribute('data-bs-theme', saved);
    sw.checked = (saved === 'dark');

    // Ao mudar o checkbox, alterna o data-bs-theme e salva
    sw.addEventListener('change', () => {
      const next = sw.checked ? 'dark' : 'light';
      html.setAttribute('data-bs-theme', next);
      localStorage.setItem('theme', next);
    });
 });