// The intro, on every load: the screen dims and a spotlight moves from the fly, to your cards, to
// your actions, one line each. Any click (or tap) anywhere moves it on; it blocks the game below.

export interface IntroStep {
  rect: () => DOMRect | null; // what to light up, in page pixels
  text: string;
}

const PAD = 14;

export function runIntro(steps: IntroStep[]): Promise<void> {
  return new Promise((resolve) => {
    const root = document.createElement("div");
    root.className = "intro";
    const hole = document.createElement("div");
    hole.className = "intro__hole";
    const text = document.createElement("p");
    text.className = "intro__text";
    root.append(hole, text);
    document.body.append(root);
    // The spotlight starts as the whole screen, then closes in on the first step.
    Object.assign(hole.style, { left: "0px", top: "0px", width: `${innerWidth}px`, height: `${innerHeight}px` });

    let i = -1;
    const next = () => {
      i++;
      if (i >= steps.length) {
        root.classList.add("is-leaving");
        setTimeout(() => {
          root.remove();
          resolve();
        }, 300);
        return;
      }
      const r = steps[i].rect() ?? new DOMRect(innerWidth / 2, innerHeight / 2, 0, 0);
      const box = { left: r.left - PAD, top: r.top - PAD, width: r.width + 2 * PAD, height: r.height + 2 * PAD };
      Object.assign(hole.style, { left: `${box.left}px`, top: `${box.top}px`, width: `${box.width}px`, height: `${box.height}px` });
      text.textContent = steps[i].text;
      text.classList.remove("is-shown");
      void text.offsetWidth; // restart the fade
      text.classList.add("is-shown");
      // The line goes on the roomier side: under the spotlight in the top half, above it lower down.
      const below = box.top + box.height + 16;
      const tw = Math.min(448, innerWidth - 32);
      const left = Math.min(Math.max(16, box.left + box.width / 2 - tw / 2), innerWidth - tw - 16);
      Object.assign(text.style, { width: `${tw}px`, left: `${left}px` });
      if (box.top + box.height / 2 < innerHeight / 2 && below + 80 < innerHeight) Object.assign(text.style, { top: `${below}px`, bottom: "" });
      else Object.assign(text.style, { top: "", bottom: `${innerHeight - box.top + 16}px` });
    };
    root.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      next();
    });
    requestAnimationFrame(() => {
      root.classList.add("is-shown");
      next();
    });
  });
}
