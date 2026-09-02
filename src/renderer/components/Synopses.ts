export function serializeSynopsesToString(synopsesElements: SVGGElement[]): string {
    const doc = synopsesElements[0]?.ownerDocument ?? activeDocument;
    const synopsesContainer = doc.win.createSvg("g");
    synopsesContainer.setAttribute("class", "synopses-container");
    synopsesElements.forEach(element => {
        synopsesContainer.appendChild(element);
    });
    const serializer = new XMLSerializer();
    return serializer.serializeToString(synopsesContainer);
}


