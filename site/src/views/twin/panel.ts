/** Props both mode panels take from TwinView. */
import type { RefObject } from 'react';
import type { Meta, TwinFile } from '../../data/types';
import type { Level, ProgramOption, TwinIndex, Validation } from './model';

/** Where focus goes after a control that removes itself (WCAG 2.4.3: never drop to <body>). */
export type FocusTarget = 'results' | 'degree' | 'next-question';

export interface PanelProps {
  index: TwinIndex;
  meta: Meta;
  twin: TwinFile;
  validation: Validation;
  /** The raw ?year= value (the year field keeps its own draft). */
  yearRaw: string;
  formRef: RefObject<HTMLFormElement | null>;
  /** The results heading (tabIndex -1), so the view can move focus to it. */
  headingRef: RefObject<HTMLHeadingElement | null>;
  /** Programs for the chosen level, largest first. */
  programs: ProgramOption[];
  programsFor: (level: Level) => ProgramOption[];
  /** twin.json min_group: the smallest group published. */
  minGroup: number;
  onLevel: (level: Level) => void;
  onProgram: (program: string) => void;
  onYear: (year: string) => void;
  /** Ask the view to move focus after the next render. */
  focusNext: (target: FocusTarget) => void;
}

export const reducedMotion = () => !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
