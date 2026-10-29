import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProgramPicker, filterOptions } from './ProgramPicker';
import type { PickerOption } from './ProgramPicker';

const OPTIONS: PickerOption[] = [
  { value: 'all', label: 'All programs', n: 24555 },
  { value: 'Commerce', label: 'Commerce', n: 3533 },
  { value: 'Economics', label: 'Economics', n: 1092 },
  { value: 'Études françaises', label: 'Études françaises', n: 61, hint: 'Undergrad' },
  { value: 'Computer Engineering', label: 'Computer Engineering', n: 507 },
  { value: 'Art History', label: 'Art History', n: 183 },
  ...Array.from({ length: 12 }, (_, i) => ({ value: `P${i}`, label: `Program ${i}`, n: 100 - i })),
];

function Harness({ onChange = () => {}, start = 'all', disabled = false }: { onChange?: (v: string) => void; start?: string | null; disabled?: boolean }) {
  const [v, setV] = useState<string | null>(start);
  return (
    <>
      <button type="button">Before</button>
      <ProgramPicker
        label="Program"
        options={OPTIONS}
        value={v}
        onChange={(next) => { setV(next); onChange(next); }}
        disabled={disabled}
        disabledReason="Choose a level to pick a program"
      />
      <button type="button">After</button>
    </>
  );
}

const combo = () => screen.getByRole('combobox', { name: 'Program' });
const list = () => screen.queryByRole('listbox', { name: 'Programs' });
const active = () => {
  const id = combo().getAttribute('aria-activedescendant');
  return id ? document.getElementById(id)?.querySelector('.combo__name')?.textContent : null;
};

describe('ProgramPicker', () => {
  it('is a labelled combobox showing the current choice, or a placeholder', () => {
    const { unmount } = render(<Harness />);
    expect(combo()).toHaveValue('All programs');
    expect(combo()).toHaveAttribute('aria-expanded', 'false');
    expect(list()).toBeNull();
    unmount();
    render(<Harness start={null} />);
    expect(combo()).toHaveValue('');
    expect(combo()).toHaveAttribute('placeholder', 'Search programs');
  });

  it('opens on ArrowDown at the current choice, moves with the arrows and Page keys, picks with Enter', async () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} start="Economics" />);
    combo().focus();
    await userEvent.keyboard('{ArrowDown}');
    expect(combo()).toHaveAttribute('aria-expanded', 'true');
    expect(active()).toBe('Economics');
    await userEvent.keyboard('{ArrowDown}');
    expect(active()).toBe('Études françaises');
    await userEvent.keyboard('{ArrowUp}{ArrowUp}{ArrowUp}{ArrowUp}');
    expect(active()).toBe('All programs'); // stops at the top
    await userEvent.keyboard('{PageDown}');
    expect(active()).toBe('Program 2');
    await userEvent.keyboard('{PageUp}{ArrowDown}');
    expect(active()).toBe('Commerce');
    await userEvent.keyboard('{Enter}');
    expect(onChange).toHaveBeenCalledWith('Commerce');
    expect(combo()).toHaveValue('Commerce');
    expect(list()).toBeNull();
    expect(combo()).toHaveFocus();
  });

  it('filters as you type (accents and case ignored), shows hints, and announces the count', async () => {
    const { container } = render(<Harness start="Commerce" />);
    await userEvent.click(combo());
    expect(combo()).toHaveAttribute('aria-expanded', 'true');
    await userEvent.clear(combo());
    await userEvent.type(combo(), 'etudes');
    const options = within(list()!).getAllByRole('option');
    expect(options).toHaveLength(1);
    expect(options[0]).toHaveTextContent('Études françaisesUndergrad61');
    expect(container.querySelector('[aria-live="polite"]')).toHaveTextContent('1 program match');
    await userEvent.clear(combo());
    await userEvent.type(combo(), 'zzz');
    expect(screen.getByText('No programs match “zzz”')).toBeInTheDocument();
    expect(container.querySelector('[aria-live="polite"]')).toHaveTextContent('0 programs match');
  });

  it('Escape closes the list and restores the current choice without bubbling', async () => {
    const outside = vi.fn();
    document.addEventListener('keydown', outside);
    render(<Harness start="Commerce" />);
    await userEvent.click(combo());
    await userEvent.clear(combo());
    await userEvent.type(combo(), 'eco');
    await userEvent.keyboard('{Escape}');
    expect(list()).toBeNull();
    expect(combo()).toHaveValue('Commerce');
    expect(combo()).toHaveFocus();
    expect(outside.mock.calls.filter(([e]) => (e as KeyboardEvent).key === 'Escape')).toHaveLength(0);
    // a second Escape (nothing to close) is left for the page, e.g. to clear a chart pin
    await userEvent.keyboard('{Escape}');
    expect(outside.mock.calls.filter(([e]) => (e as KeyboardEvent).key === 'Escape')).toHaveLength(1);
    document.removeEventListener('keydown', outside);
  });

  it('Tab closes the list without choosing, and focus moves on to the next control (not <body>)', async () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} start="Commerce" />);
    await userEvent.click(screen.getByRole('button', { name: 'Before' }));
    await userEvent.tab();
    expect(combo()).toHaveFocus();
    await userEvent.keyboard('{ArrowDown}{ArrowDown}');
    expect(list()).not.toBeNull();
    await userEvent.tab();
    expect(list()).toBeNull();
    expect(combo()).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByRole('button', { name: 'After' })).toHaveFocus();
    expect(document.activeElement).not.toBe(document.body);
    expect(onChange).not.toHaveBeenCalled();
    expect(combo()).toHaveValue('Commerce');
    // Shift+Tab comes back to the picker, closed
    await userEvent.tab({ shift: true });
    expect(combo()).toHaveFocus();
    expect(list()).toBeNull();
  });

  it('typing a label exactly and leaving picks it', async () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    await userEvent.click(combo());
    await userEvent.clear(combo());
    await userEvent.type(combo(), 'art history');
    await userEvent.tab();
    expect(onChange).toHaveBeenCalledWith('Art History');
    expect(combo()).toHaveValue('Art History');
  });

  it('picks with a click and keeps focus in the input', async () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    await userEvent.click(combo());
    await userEvent.click(within(list()!).getByRole('option', { name: /Economics/ }));
    expect(onChange).toHaveBeenCalledWith('Economics');
    expect(combo()).toHaveFocus();
    expect(list()).toBeNull();
  });

  it('the chevron opens and closes the full list', async () => {
    render(<Harness />);
    await userEvent.click(screen.getByRole('button', { name: 'Show all programs' }));
    expect(within(list()!).getAllByRole('option')).toHaveLength(OPTIONS.length);
    expect(combo()).toHaveFocus();
    await userEvent.click(screen.getByRole('button', { name: 'Close programs' }));
    expect(list()).toBeNull();
  });

  it('can be disabled, with the reason as a tooltip', async () => {
    render(<Harness disabled />);
    expect(combo()).toBeDisabled();
    expect(combo()).toHaveAttribute('title', 'Choose a level to pick a program');
    fireEvent.keyDown(combo(), { key: 'ArrowDown' });
    expect(list()).toBeNull();
  });
});

describe('ProgramPicker hideLabelBelow', () => {
  /** matchMedia that answers max-width queries for a `width`-px viewport; `resize` fires change events. */
  function viewport(width: number) {
    let w = width;
    const listeners = new Set<() => void>();
    vi.spyOn(window, 'matchMedia').mockImplementation((query: string) => {
      const max = /max-width:\s*([\d.]+)px/.exec(query);
      return {
        matches: max ? w <= Number(max[1]) : false,
        media: query,
        onchange: null,
        addEventListener: (_: string, cb: () => void) => listeners.add(cb),
        removeEventListener: (_: string, cb: () => void) => listeners.delete(cb),
        addListener() {},
        removeListener() {},
        dispatchEvent: () => false,
      } as unknown as MediaQueryList;
    });
    return { resize(next: number) { w = next; act(() => listeners.forEach((cb) => cb())); } };
  }

  afterEach(() => vi.restoreAllMocks());

  const picker = () => <ProgramPicker label="Program" options={OPTIONS} value="all" onChange={() => {}} hideLabelBelow={640} />;

  it('shows the label on wide screens', () => {
    viewport(1280);
    render(picker());
    expect(screen.getByText('Program', { selector: 'label' })).toHaveClass('field__label');
    expect(combo()).toBeInTheDocument();
  });

  it('keeps the label for screen readers only below the width, so the combobox is still named', () => {
    const vp = viewport(375);
    render(picker());
    const label = screen.getByText('Program', { selector: 'label' });
    expect(label).toHaveClass('sr-only');
    expect(label).not.toHaveClass('field__label');
    expect(combo()).toHaveAccessibleName('Program');
    expect(label).toHaveAttribute('for', combo().id);
    vp.resize(640);
    expect(label).toHaveClass('field__label');
    vp.resize(639);
    expect(label).toHaveClass('sr-only');
  });

  it('hideLabel still hides it at every width', () => {
    viewport(1280);
    render(<ProgramPicker label="Program" options={OPTIONS} value="all" onChange={() => {}} hideLabel hideLabelBelow={640} />);
    expect(screen.getByText('Program', { selector: 'label' })).toHaveClass('sr-only');
  });
});

describe('filterOptions', () => {
  const opts = (labels: string[]) => labels.map((l) => ({ value: l, label: l }));

  it('ranks prefix matches, then word starts, then anything containing every word', () => {
    const list = opts(['Applied Economics', 'Economics', 'Socioeconomics', 'Mathematics and Economics']);
    expect(filterOptions(list, 'econ').map((o) => o.value))
      .toEqual(['Economics', 'Applied Economics', 'Mathematics and Economics', 'Socioeconomics']);
    expect(filterOptions(list, 'math econ').map((o) => o.value)).toEqual(['Mathematics and Economics']);
    expect(filterOptions(list, '   ')).toBe(list);
  });
});
