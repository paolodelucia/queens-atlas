import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { labelInName } from './labelInName';
import { Segmented } from './Segmented';
import type { SegOption } from './Segmented';

type C = 'all' | '2005' | '2016' | '2021';
const OPTIONS: SegOption<C>[] = [
  { value: 'all', label: 'All', ariaLabel: 'All classes', tooltip: 'All classes' },
  { value: '2005', label: '2005–2015', short: '’05–’15', ariaLabel: 'Class of 2005–2015', tooltip: 'Class of 2005–2015' },
  {
    value: '2016', label: '2016–2020', short: '’16–’20', ariaLabel: 'Class of 2016–2020', tooltip: 'Class of 2016–2020',
    disabled: true, reason: 'Fewer than 50 people',
  },
  { value: '2021', label: '2021–2024', short: '’21–’24', ariaLabel: 'Class of 2021–2024', tooltip: 'Class of 2021–2024' },
];

function Harness({ onChange = () => {}, start = 'all', hideLegend = false, options = OPTIONS, fit }: {
  onChange?: (v: C) => void; start?: C; hideLegend?: boolean; options?: SegOption<C>[]; fit?: 'auto' | 'fill';
}) {
  const [v, setV] = useState<C>(start);
  return (
    <Segmented
      legend="Graduating class"
      hideLegend={hideLegend}
      options={options}
      value={v}
      fit={fit}
      onChange={(next) => { setV(next); onChange(next); }}
    />
  );
}

/** Pretend the viewport is `width` px wide: matchMedia answers max-width queries, and `resize` fires change events. */
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
  return {
    resize(next: number) {
      w = next;
      act(() => listeners.forEach((cb) => cb()));
    },
  };
}

const radios = () => screen.getAllByRole('radio');
const names = () => radios().map((r) => r.getAttribute('aria-label'));

afterEach(() => vi.restoreAllMocks());

describe('Segmented', () => {
  it('is a labelled radio group whose options take a fuller name that contains what they show', () => {
    render(<Harness />);
    const group = screen.getByRole('group', { name: 'Graduating class' });
    expect(group.tagName).toBe('FIELDSET');
    expect(names()).toEqual(['All classes', 'Class of 2005–2015', 'Class of 2016–2020', 'Class of 2021–2024']);
    expect(screen.getByRole('radio', { name: 'All classes' })).toBeChecked();
    // a name that already contains the visible text needs no description
    expect(screen.getByRole('radio', { name: 'Class of 2005–2015' })).not.toHaveAttribute('aria-describedby');
  });

  it('renders both the long and the short label (CSS picks one by width)', () => {
    const { container } = render(<Harness />);
    expect(container.querySelector('.seg__long')).toHaveTextContent('2005–2015');
    expect(container.querySelector('.seg__short')).toHaveTextContent('’05–’15');
  });

  it('names a short label by what it shows under 520px, with the long form as its description (WCAG 2.5.3)', () => {
    viewport(375);
    render(<Harness />);
    expect(names()).toEqual(['All classes', '’05–’15', '’16–’20', '’21–’24']);
    const opt = screen.getByRole('radio', { name: '’05–’15' });
    expect(opt).toHaveAccessibleDescription('Class of 2005–2015');
    // every name contains the visible text the way axe's label-content-name-mismatch compares them
    for (const r of radios()) {
      const face = r.closest('label')!.querySelector('.seg__face')!;
      const shown = face.querySelector('.seg__short')?.textContent ?? face.textContent!;
      expect(labelInName(shown, r.getAttribute('aria-label')!)).toBe(true);
    }
    // the tooltip is unchanged
    expect(opt.closest('label')).toHaveAttribute('title', 'Class of 2005–2015');
  });

  it('follows the viewport as it crosses 520px', () => {
    const vp = viewport(1280);
    render(<Harness />);
    expect(screen.getByRole('radio', { name: 'Class of 2005–2015' })).toBeInTheDocument();
    vp.resize(400);
    expect(screen.getByRole('radio', { name: '’05–’15' })).toHaveAccessibleDescription('Class of 2005–2015');
    vp.resize(520);
    expect(screen.getByRole('radio', { name: 'Class of 2005–2015' })).not.toHaveAttribute('aria-describedby');
  });

  it('uses the long label as the description of a short one when no ariaLabel is given', () => {
    viewport(375);
    render(<Harness options={[
      { value: 'all', label: 'All' },
      { value: '2005', label: '2005–2015', short: '’05–’15' },
    ]} />);
    expect(names()).toEqual(['All', '’05–’15']);
    expect(screen.getByRole('radio', { name: '’05–’15' })).toHaveAccessibleDescription('2005–2015');
    expect(screen.getByRole('radio', { name: 'All' })).not.toHaveAttribute('aria-describedby');
  });

  it('never lets an ariaLabel that leaves out the visible text replace it: it becomes the description', () => {
    type L = 'u' | 'jd' | 'law' | 'pct';
    render(
      <Segmented<L>
        legend="Degree"
        value="u"
        onChange={() => {}}
        options={[
          { value: 'u', label: 'Undergrad', ariaLabel: 'Undergraduate' }, // a different word
          { value: 'jd', label: 'JD', ariaLabel: 'Law (JD)' }, // parentheses don't count, as in axe
          { value: 'law', label: 'Law', ariaLabel: 'Law (JD)' },
          { value: 'pct', label: '%', ariaLabel: 'Percent' }, // a symbol has no words to match
        ]}
      />,
    );
    expect(names()).toEqual(['Undergrad', 'JD', 'Law (JD)', 'Percent']);
    expect(screen.getByRole('radio', { name: 'Undergrad' })).toHaveAccessibleDescription('Undergraduate');
    expect(screen.getByRole('radio', { name: 'JD' })).toHaveAccessibleDescription('Law (JD)');
    expect(screen.getByRole('radio', { name: 'Law (JD)' })).not.toHaveAttribute('aria-describedby');
  });

  it('changes on click and with the arrow keys, skipping disabled options', async () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    await userEvent.click(screen.getByRole('radio', { name: 'Class of 2005–2015' }));
    expect(onChange).toHaveBeenLastCalledWith('2005');
    expect(screen.getByRole('radio', { name: 'Class of 2005–2015' })).toHaveFocus();
    await userEvent.keyboard('{ArrowRight}');
    expect(onChange).toHaveBeenLastCalledWith('2021'); // 2016–2020 is disabled
    expect(screen.getByRole('radio', { name: 'Class of 2021–2024' })).toBeChecked();
    await userEvent.keyboard('{ArrowLeft}');
    expect(onChange).toHaveBeenLastCalledWith('2005');
  });

  it('keeps a disabled option out of reach and explains why', async () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    const off = screen.getByRole('radio', { name: 'Class of 2016–2020' });
    expect(off).toBeDisabled();
    expect(off).toHaveAccessibleDescription('Fewer than 50 people');
    expect(off.closest('label')).toHaveAttribute('title', 'Class of 2016–2020: Fewer than 50 people');
    await userEvent.click(off.closest('label')!);
    expect(onChange).not.toHaveBeenCalled();
    // enabled options carry their tooltip, and no description
    expect(screen.getByRole('radio', { name: 'Class of 2005–2015' }).closest('label')).toHaveAttribute('title', 'Class of 2005–2015');
    expect(screen.getByRole('radio', { name: 'Class of 2005–2015' })).not.toHaveAttribute('aria-describedby');
  });

  it('reads both the long form and the reason for a short, disabled option on phones', () => {
    viewport(375);
    render(<Harness />);
    expect(screen.getByRole('radio', { name: '’16–’20' })).toHaveAccessibleDescription('Class of 2016–2020 Fewer than 50 people');
  });

  it('has no tooltip unless one is given (the accessible name is separate)', () => {
    render(<Harness options={[{ value: 'all', label: 'All', ariaLabel: 'All classes' }, { value: '2005', label: '2005–2015' }]} />);
    expect(screen.getByRole('radio', { name: 'All classes' }).closest('label')).not.toHaveAttribute('title');
  });

  it('shows a disabled current value as selected (a dead end reached by URL)', () => {
    render(<Harness start="2016" />);
    const off = screen.getByRole('radio', { name: 'Class of 2016–2020' });
    expect(off).toBeChecked();
    expect(off).toBeDisabled();
  });

  it('can keep the legend for screen readers only', () => {
    render(<Harness hideLegend />);
    expect(screen.getByText('Graduating class')).toHaveClass('sr-only');
    expect(screen.getByRole('group', { name: 'Graduating class' })).toBeInTheDocument();
  });

  it('fit="fill" adds the phone fill layout class; the default keeps the natural width', () => {
    const { unmount } = render(<Harness fit="fill" />);
    const group = screen.getByRole('group', { name: 'Graduating class' });
    expect(group).toHaveClass('field', 'field--fill');
    expect(within(group).getAllByRole('radio')).toHaveLength(4);
    unmount();
    render(<Harness />);
    expect(screen.getByRole('group', { name: 'Graduating class' })).not.toHaveClass('field--fill');
  });
});

describe('labelInName', () => {
  it('matches whole words in order, ignoring case, punctuation, accents and parentheses (like axe)', () => {
    expect(labelInName('2005–2015', 'Class of 2005–2015')).toBe(true);
    expect(labelInName('’95–’04', 'Classes of 1995–2004')).toBe(false);
    expect(labelInName('’95–’04', '’95–’04')).toBe(true);
    expect(labelInName('All', 'All alumni')).toBe(true);
    expect(labelInName('Undergrad', 'Undergraduate')).toBe(false);
    expect(labelInName('JD', 'Law (JD)')).toBe(false);
    expect(labelInName('JD', 'JD (law)')).toBe(true);
    expect(labelInName('Master’s/PhD', 'Master’s/PhD (graduate)')).toBe(true);
    expect(labelInName('Grad', 'Master’s/PhD (graduate)')).toBe(false);
    expect(labelInName('show ALL fields', 'Show all fields')).toBe(true);
    expect(labelInName('all show', 'Show all fields')).toBe(false);
    expect(labelInName('Études', 'Études françaises')).toBe(true);
    expect(labelInName('%', 'Percent')).toBe(true);
  });
});
