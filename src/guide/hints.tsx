// The help that sits on the page (decision 49): the `?` on each card, which lights the card with
// its hint and "show me" links, and the beacons, dots on three controls shown until dismissed.
// driver.js 1.3.1 has no hints API, so the dots are drawn here and a click opens a driver.js
// popover on the control. Nothing here changes a number, a step id or stored state beyond
// `sourdough.v1.guide` (the beacons dismissed); kitchen mode and print carry none of it.
import { useEffect, useRef, useState, type ReactElement } from "react";
import { createPortal } from "react-dom";
import type { DriveStep, PopoverDOM } from "driver.js";
import {
  BEACONS,
  HINTS,
  guideSelector,
  type BeaconTarget,
  type Hint,
  type HintCard,
  type ShowMe,
} from "./copy";
import { findTarget, loadGuide, runGuide, saveGuide, stopGuide, themePopover } from "./tour";

const escape = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * What a hint card lights: the card, or its header row when the card is taller than most of the
 * screen, so the popover sits beside what was tapped instead of over the middle of the card.
 */
function litPart(card: Element): Element {
  const tall = card.getBoundingClientRect().height > window.innerHeight * 0.6;
  return (tall && card.querySelector(":scope > header")) || card;
}

/** The card's step: its hint and a "show me" link per target on the page now. */
function cardStep(hint: Hint, card: Element): DriveStep {
  const links = hint.showMe.filter((m) => findTarget(m.target));
  const list = links.length
    ? `<span class="guide-show-list">${links
        .map(
          (m, i) =>
            `<button type="button" class="guide-show" data-show="${i}">Show me ${escape(m.label)}</button>`,
        )
        .join("")}</span>`
    : "";
  return {
    element: litPart(card),
    popover: {
      title: escape(hint.title),
      description: `${escape(hint.body)}${list}`,
      showButtons: ["close"],
      // The arrow keys move a tour; on a card there is nowhere to move to.
      onNextClick: () => {},
      onPopoverRender: (popover: PopoverDOM) => {
        themePopover(popover);
        popover.description.querySelectorAll<HTMLButtonElement>(".guide-show").forEach((b) => {
          const m = links[Number(b.dataset.show)];
          if (m) b.addEventListener("click", () => showMe(hint, card, m));
        });
      },
    },
  };
}

/** Lights one element with its own line; Back returns to the card. */
function showMe(hint: Hint, card: Element, m: ShowMe): void {
  const element = findTarget(m.target);
  if (!element) return;
  runGuide(
    [
      cardStep(hint, card),
      {
        element,
        popover: {
          title: escape(m.label.charAt(0).toUpperCase() + m.label.slice(1)),
          description: escape(m.body),
          showButtons: ["previous", "close"],
          prevBtnText: "Back",
          onNextClick: () => {},
        },
      },
    ],
    {},
    1,
  );
}

/** The `?` after a card's title: opens that card's hint (decision 49). Not printed. */
export function HintButton({ card }: { card: HintCard }): ReactElement {
  const hint = HINTS[card];
  return (
    <button
      type="button"
      className="guide-q no-print"
      aria-label={`About ${hint.title}`}
      aria-haspopup="dialog"
      onClick={(e) => {
        const el = e.currentTarget.closest(guideSelector(hint.target));
        if (el) runGuide([cardStep(hint, el)]);
      }}
    >
      ?
    </button>
  );
}

/** A beacon's dot, in page coordinates: the top-left corner of its control. */
interface Spot {
  target: BeaconTarget;
  x: number;
  y: number;
}

const BEACON_TARGETS = Object.keys(BEACONS) as BeaconTarget[];

const sameSpots = (a: Spot[], b: Spot[]) =>
  a.length === b.length &&
  a.every((s, i) => s.target === b[i]!.target && s.x === b[i]!.x && s.y === b[i]!.y);

/**
 * The beacons (decision 49): a pulsing dot on each of the add-ins tick box, the In order / By
 * dough toggle and the Tangzhong part that is on the page and not yet dismissed. Those controls
 * come and go as the plan changes (the tick box only with add-ins, the toggle only with more than
 * one dough, the Tangzhong part only in an opened dough form), so the dots follow the page: one
 * measurement per frame at most, after a DOM change or a resize. A click opens the control's
 * line; "Got it" dismisses that beacon for this browser. Mount it once, outside kitchen mode.
 */
export function Beacons(): ReactElement | null {
  const [dismissed, setDismissed] = useState<string[]>(() => loadGuide().dismissed);
  const [spots, setSpots] = useState<Spot[]>([]);
  const layer = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let frame = 0;
    const measure = () => {
      frame = 0;
      const next = BEACON_TARGETS.filter((t) => !dismissed.includes(t)).flatMap((target) => {
        const el = findTarget(target);
        if (!el) return [];
        const r = el.getBoundingClientRect();
        return [{ target, x: Math.round(r.left + scrollX), y: Math.round(r.top + scrollY) }];
      });
      setSpots((prev) => (sameSpots(prev, next) ? prev : next));
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    const changes = new MutationObserver((records) => {
      if (records.some((r) => !layer.current?.contains(r.target))) schedule();
    });
    changes.observe(document.body, { childList: true, subtree: true, characterData: true });
    const sizes = new ResizeObserver(schedule);
    sizes.observe(document.body);
    window.addEventListener("resize", schedule);
    schedule();
    return () => {
      changes.disconnect();
      sizes.disconnect();
      window.removeEventListener("resize", schedule);
      cancelAnimationFrame(frame);
    };
  }, [dismissed]);

  const open = (target: BeaconTarget) => {
    const element = findTarget(target);
    if (!element) return;
    const beacon = BEACONS[target];
    runGuide([
      {
        element,
        popover: {
          title: escape(beacon.title),
          description: escape(beacon.body),
          showButtons: ["next", "close"],
          nextBtnText: "Got it",
          onNextClick: () => {
            const stored = loadGuide();
            const next = [...new Set([...stored.dismissed, target])];
            saveGuide({ ...stored, dismissed: next });
            setDismissed(next);
            stopGuide();
          },
        },
      },
    ]);
  };

  if (spots.length === 0) return null;
  return createPortal(
    <div className="guide-beacons" ref={layer}>
      {spots.map((s) => (
        <button
          key={s.target}
          type="button"
          className="guide-beacon"
          data-beacon={s.target}
          style={{ left: s.x, top: s.y }}
          aria-label={`Tip: ${BEACONS[s.target].title}`}
          aria-haspopup="dialog"
          onClick={() => open(s.target)}
        />
      ))}
    </div>,
    document.body,
  );
}
