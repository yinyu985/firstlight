export interface ScrollbarMetrics {
  visible: boolean;
  offset: number;
  length: number;
}

export interface ScrollbarMetricsOptions {
  inset?: number;
  maxLength?: number;
}

export function scrollbarMetrics(element: HTMLElement, options: ScrollbarMetricsOptions = {}): ScrollbarMetrics {
  const inset = options.inset ?? 2;
  const maxLength = options.maxLength ?? 20;
  const scrollRange = element.scrollHeight - element.clientHeight;
  const trackLength = Math.max(0, element.clientHeight - inset * 2);
  const length = Math.min(maxLength, trackLength);
  const travel = Math.max(0, trackLength - length);
  return {
    visible: scrollRange > 1 && length > 0,
    offset: scrollRange > 0 ? (element.scrollTop / scrollRange) * travel : 0,
    length
  };
}