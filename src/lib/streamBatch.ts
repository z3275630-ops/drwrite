/** Coalesce visual stream updates; finish/error must call flush before settling. */
export class StreamBatch {
  private frame: number | null = null;
  private content: string | undefined;
  private reasoning: number | undefined;
  constructor(private handlers: { onContent?: (full: string) => void; onReasoning?: (chars: number) => void },
    private schedule: (callback: () => void) => number = requestAnimationFrame,
    private cancel: (id: number) => void = cancelAnimationFrame) {}
  pushContent(full: string) { this.content = full; this.enqueue(); }
  pushReasoning(chars: number) { this.reasoning = chars; this.enqueue(); }
  private enqueue() { if (this.frame === null) this.frame = this.schedule(() => this.flush()); }
  flush() {
    if (this.frame !== null) this.cancel(this.frame);
    this.frame = null;
    const content = this.content, reasoning = this.reasoning;
    this.content = undefined; this.reasoning = undefined;
    if (content !== undefined) this.handlers.onContent?.(content);
    if (reasoning !== undefined) this.handlers.onReasoning?.(reasoning);
  }
}
