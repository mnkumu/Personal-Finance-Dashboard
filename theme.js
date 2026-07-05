(function(){
  const root = document.documentElement;
  const sunIcon = document.getElementById('themeIconSun');
  const moonIcon = document.getElementById('themeIconMoon');
  const toggleBtn = document.getElementById('themeToggleBtn');
  const STORAGE_KEY = 'mortgageDashboardTheme';

  function applyTheme(theme){
    if(theme === 'dark'){
      root.setAttribute('data-theme','dark');
      sunIcon.style.display = 'none';
      moonIcon.style.display = '';
    } else {
      root.removeAttribute('data-theme');
      sunIcon.style.display = '';
      moonIcon.style.display = 'none';
    }
  }

  function getInitialTheme(){
    const saved = localStorage.getItem(STORAGE_KEY);
    if(saved === 'dark' || saved === 'light') return saved;
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  let currentTheme = getInitialTheme();
  applyTheme(currentTheme);

  toggleBtn.addEventListener('click', () => {
    currentTheme = currentTheme === 'dark' ? 'light' : 'dark';
    localStorage.setItem(STORAGE_KEY, currentTheme);
    applyTheme(currentTheme);
  });

  if(window.matchMedia){
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', e => {
      if(!localStorage.getItem(STORAGE_KEY)){
        currentTheme = e.matches ? 'dark' : 'light';
        applyTheme(currentTheme);
      }
    });
  }
})();
