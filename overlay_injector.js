/**
 * RenderX Image Studio - 70%-Width In-Browser Dock Injector
 * Mounts #renderx-browser-dock fixed to the right 70vw of the active tab,
 * keeping the left 30vw unobstructed with a collapse/expand toggle handle.
 */

(function () {
  const DOCK_ID = 'renderx-browser-dock';
  const TOGGLE_ID = 'renderx-dock-toggle';
  const IFRAME_ID = 'renderx-dock-iframe';

  // If already mounted on this page, toggle collapse/expand state cleanly
  const existingDock = document.getElementById(DOCK_ID);
  const existingToggle = document.getElementById(TOGGLE_ID);
  if (existingDock) {
    const isCollapsed = existingDock.dataset.collapsed === 'true';
    setDockCollapsed(!isCollapsed, existingDock, existingToggle);
    return;
  }

  function setDockCollapsed(collapsed, dockEl, toggleEl) {
    dockEl.dataset.collapsed = collapsed ? 'true' : 'false';
    if (collapsed) {
      dockEl.style.transform = 'translateX(70vw)';
      dockEl.style.pointerEvents = 'none';
      if (toggleEl) {
        toggleEl.style.right = '0px';
        toggleEl.innerHTML = '❮';
        toggleEl.title = 'Expand RenderX Image Studio (70vw)';
      }
    } else {
      dockEl.style.transform = 'translateX(0)';
      dockEl.style.pointerEvents = 'auto';
      if (toggleEl) {
        toggleEl.style.right = '70vw';
        toggleEl.innerHTML = '❯';
        toggleEl.title = 'Collapse RenderX Image Studio';
      }
    }
  }

  // Create outer 70vw docked workspace container
  const dock = document.createElement('div');
  dock.id = DOCK_ID;
  dock.dataset.collapsed = 'false';
  Object.assign(dock.style, {
    position: 'fixed',
    top: '0',
    right: '0',
    width: '70vw',
    height: '100vh',
    zIndex: '2147483647',
    backgroundColor: '#05070B',
    borderLeft: '1px solid #1E293B',
    boxShadow: '-10px 0 36px rgba(0, 0, 0, 0.8)',
    overflowY: 'auto',
    overflowX: 'hidden',
    scrollBehavior: 'smooth',
    transition: 'transform 0.24s cubic-bezier(0.22, 1, 0.36, 1)',
    margin: '0',
    padding: '0',
    boxSizing: 'border-box'
  });

  // Create dashboard.html iframe with smooth vertical scroll support
  const iframe = document.createElement('iframe');
  iframe.id = IFRAME_ID;
  iframe.src = chrome.runtime.getURL('dashboard.html');
  iframe.setAttribute('scrolling', 'yes');
  iframe.setAttribute('allow', 'clipboard-read; clipboard-write');
  Object.assign(iframe.style, {
    width: '100%',
    height: '100%',
    border: 'none',
    display: 'block',
    backgroundColor: '#05070B',
    overflowY: 'auto',
    scrollBehavior: 'smooth'
  });

  dock.appendChild(iframe);

  // Compact collapse/expand toggle handle on the dock's left border (leaves left 30vw unobstructed)
  const toggleBtn = document.createElement('button');
  toggleBtn.id = TOGGLE_ID;
  toggleBtn.type = 'button';
  toggleBtn.innerHTML = '❯';
  toggleBtn.title = 'Collapse RenderX Image Studio';
  Object.assign(toggleBtn.style, {
    position: 'fixed',
    top: '50%',
    right: '70vw',
    transform: 'translateY(-50%)',
    width: '26px',
    height: '64px',
    zIndex: '2147483647',
    backgroundColor: '#0A0F1D',
    color: '#38BDF8',
    border: '1px solid #1E293B',
    borderRight: 'none',
    borderRadius: '8px 0 0 8px',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '13px',
    fontWeight: '900',
    boxShadow: '-4px 0 14px rgba(0, 0, 0, 0.55)',
    transition: 'right 0.24s cubic-bezier(0.22, 1, 0.36, 1), background-color 0.15s ease',
    padding: '0',
    outline: 'none'
  });

  toggleBtn.addEventListener('mouseenter', () => {
    toggleBtn.style.backgroundColor = '#152033';
    toggleBtn.style.color = '#FFFFFF';
  });
  toggleBtn.addEventListener('mouseleave', () => {
    toggleBtn.style.backgroundColor = '#0A0F1D';
    toggleBtn.style.color = '#38BDF8';
  });
  toggleBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const isCollapsed = dock.dataset.collapsed === 'true';
    setDockCollapsed(!isCollapsed, dock, toggleBtn);
  });

  const mountRoot = document.body || document.documentElement;
  mountRoot.appendChild(dock);
  mountRoot.appendChild(toggleBtn);
})();
