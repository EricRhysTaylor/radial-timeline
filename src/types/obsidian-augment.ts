import type { EventRef } from 'obsidian';

export {};

declare module 'obsidian' {
  interface Component {
    registerInterval(handle: number): number;
    registerDomEvent(
      el: HTMLElement | Window | Document,
      event: string,
      // Method syntax keeps parameters bivariant, so handlers typed with
      // specific Event subclasses (KeyboardEvent, CustomEvent, ...) still fit.
      // Return type unknown (not void) so async handlers remain assignable
      // without tripping no-misused-promises; the return value is ignored.
      callback: (evt: Event) => unknown,
      options?: boolean | AddEventListenerOptions
    ): EventRef;
  }
}
