// Focuses on building SVG elements for synopses (no data rules)

export function createSynopsisContainer(sceneId: string, scenePath?: string): SVGGElement {
  const containerGroup = activeWindow.createSvg("g");
  containerGroup.setAttribute("class", "rt-scene-info rt-info-container");
  containerGroup.setAttribute("data-for-scene", sceneId);
  // Add scene path for DOM updates
  if (scenePath) {
    containerGroup.setAttribute("data-scene-path", encodeURIComponent(scenePath));
  }
  return containerGroup;
}

export function createTextGroup(): SVGGElement {
  const group = activeWindow.createSvg("g");
  group.setAttribute("class", "rt-synopsis-text");
  return group;
}

export function createText(x: number, y: number, cls: string, text: string): SVGTextElement {
  const el = activeWindow.createSvg("text");
  el.setAttribute("class", cls);
  el.setAttribute("x", String(x));
  el.setAttribute("y", String(y));
  el.setAttribute("text-anchor", "start");
  el.textContent = text;
  return el;
}


