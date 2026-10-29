import { render, screen } from '@testing-library/react';
import { StatBlock } from './StatBlock';

describe('StatBlock', () => {
  it('reads value, then label, then detail', () => {
    render(<StatBlock value="92,447" label="alumni" detail="Classes of 1995–2024" />);
    const block = screen.getByText('92,447').closest('.ui-stat')!;
    expect(block).toHaveClass('ui-stat--lg');
    expect(block.textContent).toBe('92,447 alumniClasses of 1995–2024');
    expect(screen.getByText('92,447')).toHaveClass('ui-stat__value', 'num');
    expect(screen.getByText('alumni')).toHaveClass('ui-stat__label');
    expect(screen.getByText('Classes of 1995–2024')).toHaveClass('ui-stat__detail');
  });

  it('omits an empty detail and can highlight the value', () => {
    const { container } = render(<StatBlock value="73" label="countries" detail="" highlight size="md" />);
    expect(container.querySelector('.ui-stat__detail')).toBeNull();
    expect(container.querySelector('.ui-stat')).toHaveClass('ui-stat--md');
    expect(screen.getByText('73')).toHaveClass('ui-hl');
  });

  it('renders as a list item in a list of stats', () => {
    render(
      <ul>
        <StatBlock as="li" value="1" label="one" />
        <StatBlock as="li" value="2" label="two" />
      </ul>,
    );
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    expect(screen.getAllByRole('listitem')[1]).toHaveTextContent('2 two');
  });
});
