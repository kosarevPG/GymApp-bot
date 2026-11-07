type Ordered = { order?: unknown };
type Block = { sets?: Ordered[]; cardio?: Ordered[] };

const orderOf = (item: Ordered) => Number(item.order) || 0;
const ordersOf = (block: Block) => [...(block.sets || []), ...(block.cardio || [])].map(orderOf);

/**
 * История хранит все отрезки кардио за тренировку одним блоком на упражнение.
 * Для показа он делится на заходы: разминка на дорожке и заминка в конце
 * встают каждая на своё место, если между ними были другие упражнения.
 * Отрезки подряд (сменил скорость) остаются одним заходом.
 */
export function historyBlocks<T extends Block>(exercises: T[]): T[] {
  const pieces = exercises.flatMap((block, index) => {
    if (!block.cardio || block.cardio.length < 2) return [block];
    const others = exercises.filter((_, j) => j !== index).flatMap(ordersOf);
    const segments = [...block.cardio].sort((a, b) => orderOf(a) - orderOf(b));
    const visits: Ordered[][] = [[segments[0]]];
    for (let k = 1; k < segments.length; k += 1) {
      const from = orderOf(segments[k - 1]), to = orderOf(segments[k]);
      if (others.some(order => order > from && order < to)) visits.push([segments[k]]);
      else visits[visits.length - 1].push(segments[k]);
    }
    return visits.map(cardio => ({ ...block, cardio }));
  });
  return pieces
    .map((block, index) => ({ block, index, first: Math.min(...ordersOf(block)) }))
    .sort((a, b) => a.first - b.first || a.index - b.index)
    .map(item => item.block);
}
