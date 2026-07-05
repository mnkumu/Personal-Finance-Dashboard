// ---- Sidebar open/close (off-canvas overlay) ----
const sidebarEl = document.getElementById('sidebar');
const sidebarBackdrop = document.getElementById('sidebarBackdrop');
const hamburgerBtn = document.getElementById('hamburgerBtn');
const sidebarCloseBtn = document.getElementById('sidebarCloseBtn');

function openSidebar(){
  sidebarEl.classList.add('open');
  sidebarBackdrop.classList.add('open');
  hamburgerBtn.setAttribute('aria-label', 'Close menu');
  hamburgerBtn.title = 'Close menu';
}
function closeSidebar(){
  sidebarEl.classList.remove('open');
  sidebarBackdrop.classList.remove('open');
  hamburgerBtn.setAttribute('aria-label', 'Open menu');
  hamburgerBtn.title = 'Open menu';
}
hamburgerBtn.addEventListener('click', () => {
  if(sidebarEl.classList.contains('open')) closeSidebar(); else openSidebar();
});
sidebarCloseBtn.addEventListener('click', closeSidebar);
sidebarBackdrop.addEventListener('click', closeSidebar);
document.addEventListener('keydown', e => {
  if(e.key === 'Escape') closeSidebar();
});

