// The walkthrough (decisions 47 and 49): driver.js, bundled, in the planner's look. It runs once
// per browser on the plan page and again from the footer's "Show me around". It reads and writes
// one key, `sourdough.v1.guide`, and nothing else: no number, step id or stored plan moves.
import { createElement, type ReactElement } from "react";
import { driver, type Config, type DriveStep, type Driver, type PopoverDOM } from "driver.js";
import "driver.js/dist/driver.css";
import "./guide.css";
import { load, save } from "../lib/storage";
import { TOUR, guideSelector, type GuideTarget } from "./copy";

/** What this browser has seen of the guide (decision 49). */
export interface GuideState {
  /** The walkthrough has run here, to the end or closed. */
  seen: boolean;
  /** Beacons dismissed here, by target. */
  dismissed: string[];
}

// TODO(C2): use KEYS.guide and its validator from src/lib/storage.ts once C1's bundle v3 lands.
export const GUIDE_KEY = "sourdough.v1.guide";
export const DEFAULT_GUIDE: GuideState = { seen: false, dismissed: [] };

const isGuideState = (v: unknown): v is GuideState =>
  typeof v === "object" &&
  v !== null &&
  typeof (v as GuideState).seen === "boolean" &&
  Array.isArray((v as GuideState).dismissed) &&
  (v as GuideState).dismissed.every((d) => typeof d === "string");

export function loadGuide(): GuideState {
  return load(GUIDE_KEY, DEFAULT_GUIDE, isGuideState);
}

export function saveGuide(next: GuideState): void {
  save(GUIDE_KEY, next);
}

/** A target on the page and laid out (not inside something closed or `display: none`). */
export function findTarget(target: GuideTarget): Element | undefined {
  const el = document.querySelector(guideSelector(target));
  return el && el.getClientRects().length > 0 ? el : undefined;
}

/**
 * The popover in the planner's look: `.sd-pop` (guide.css) does the colours; this names the
 * dialog for screen readers, which driver.js 1.3.1 does not.
 */
export function themePopover(popover: PopoverDOM): void {
  const { wrapper, title, description, closeButton } = popover;
  wrapper.setAttribute("role", "dialog");
  wrapper.setAttribute("aria-labelledby", title.id);
  wrapper.setAttribute("aria-describedby", description.id);
  closeButton.setAttribute("aria-label", "Close the guide");
}

/**
 * What every driver here shares: the look, the stage around the lit element, and closing by the
 * ×, a click on the dim, or Escape. Hint cards (G2) start from this too.
 */
export function baseConfig(): Config {
  return {
    popoverClass: "sd-pop",
    stagePadding: 6,
    stageRadius: 14,
    allowClose: true,
    allowKeyboardControl: true,
    overlayColor: "#140e08",
    overlayOpacity: 0.55,
    onPopoverRender: (popover) => themePopover(popover),
  };
}

/** driver.js keeps one state for the page, so one guide at a time: the open one closes first. */
let active: Driver | undefined;

/** Closes whatever the guide has open (the tour, a hint card). */
export function stopGuide(): void {
  if (active?.isActive()) active.destroy();
  active = undefined;
}

/** Runs `steps` with the base config and `extra`, after closing whatever was open. */
export function runGuide(steps: DriveStep[], extra: Config = {}): Driver {
  stopGuide();
  const d = driver({ ...baseConfig(), ...extra, steps });
  active = d;
  d.drive();
  return d;
}

/**
 * The walkthrough's steps for this page. driver.js 1.3.1 has no option to skip a missing
 * element (it centres the popover on a dummy instead), so a step whose target is absent, such as
 * the view toggle on a one-dough plan or the account menu with accounts off, is left out here.
 */
export function tourSteps(): DriveStep[] {
  return TOUR.flatMap((step) => {
    const element = findTarget(step.target);
    return element ? [{ element, popover: { title: step.title, description: step.body } }] : [];
  });
}

/** Starts the walkthrough. False when nothing it points at is on the page. */
export function startTour(): boolean {
  const steps = tourSteps();
  if (steps.length === 0) return false;
  runGuide(steps, {
    showProgress: true,
    progressText: "{{current}} of {{total}}",
    nextBtnText: "Next",
    prevBtnText: "Back",
    doneBtnText: "Done",
    // Finished, closed by the ×, the dim or Escape: seen either way.
    onDestroyed: () => {
      saveGuide({ ...loadGuide(), seen: true });
      active = undefined;
    },
  });
  return true;
}

/**
 * The first visit (decision 49): the walkthrough once, on the plan page, never in kitchen mode.
 * Call it after the plan page has rendered. True when it started the tour.
 */
export function firstRun({ view, kitchen }: { view: string; kitchen: boolean }): boolean {
  if (view !== "plan" || kitchen) return false;
  if (active?.isActive()) return false; // StrictMode runs effects twice in development.
  if (loadGuide().seen) return false;
  return startTour();
}

/** The footer's "Show me around". */
export function GuideButton(): ReactElement {
  return createElement(
    "button",
    { type: "button", className: "guide-around", onClick: () => startTour() },
    "Show me around",
  );
}
