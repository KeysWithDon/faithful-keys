export const PRESS_FLASH_MS = 250;

/** @param {Element} control */
export function flashPress(control) {
  control.getAnimations().filter(animation => animation.id === 'faithful-press').forEach(animation => animation.cancel());
  const flash = control.animate(
    [{filter:'brightness(1.75) drop-shadow(0 0 5px #ffc95f)'}, {filter:'brightness(1) drop-shadow(0 0 0 transparent)'}],
    {duration:PRESS_FLASH_MS,easing:'linear'}
  );
  flash.id = 'faithful-press';
  const key = control.getAttribute('data-chord-key');
  const note = control.getAttribute('data-piano-note');
  const label = key ? [...control.querySelectorAll('text tspan')].map(part=>part.textContent).join(' ')
    : control.getAttribute('aria-label') || control.textContent?.trim();
  control.ownerDocument.dispatchEvent(new CustomEvent('faithful-press',{detail:{
    label:label?.slice(0,72) || '', key, note:note===null?null:Number(note),
  }}));
}

/** @param {Document} root */
export function installPressFeedback(root) {
  /** @param {Event} event */
  const handleClick = event => {
    if(event.defaultPrevented)return;
    const target=event.target;
    if(!(target instanceof Element))return;
    const control=target.closest('button,[role="button"],[role="option"],summary,a[download],input[type="checkbox"],input[type="radio"]');
    if(control&&!control.matches(':disabled,[aria-disabled="true"]'))flashPress(control);
  };
  /** @param {KeyboardEvent} event */
  const handleKey = event => {
    if(event.repeat||(event.key!=='Enter'&&event.key!==' '))return;
    const control=event.target;
    if(control instanceof Element&&control.matches('[role="button"]:not(button):not([aria-disabled="true"])'))flashPress(control);
  };
  root.addEventListener('click',handleClick);
  root.addEventListener('keydown',handleKey,true);
  return ()=>{
    root.removeEventListener('click',handleClick);
    root.removeEventListener('keydown',handleKey,true);
  };
}
