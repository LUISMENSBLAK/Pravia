// Claiming an uncontrolled page after the first installation is not an update.
// Reloading then loses form input (including a login currently being entered).
export function listenForServiceWorkerUpdate(
  container: Pick<ServiceWorkerContainer, 'controller' | 'addEventListener' | 'removeEventListener'>,
  reload: () => void,
) {
  const alreadyControlled = Boolean(container.controller);
  let refreshing = false;
  const onChange = () => {
    if (!alreadyControlled || refreshing) return;
    refreshing = true;
    reload();
  };
  container.addEventListener('controllerchange', onChange);
  return () => container.removeEventListener('controllerchange', onChange);
}
