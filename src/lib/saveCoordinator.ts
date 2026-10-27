/** One writer, with revisions: finishing an old write cannot mark newer typing saved. */
export class SaveCoordinator {
  private revision = 0;
  private savedRevision = 0;
  private pending: Promise<boolean> | null = null;
  error: unknown = null;

  get dirty(): boolean { return this.revision !== this.savedRevision; }
  get saving(): boolean { return this.pending !== null; }

  markDirty(): void { this.revision++; }
  reset(): void {
    if (this.pending) throw new Error('保存尚未完成，不能替换当前稿件');
    this.revision = this.savedRevision = 0;
    this.error = null;
  }

  flush(write: () => Promise<void>): Promise<boolean> {
    if (this.pending) return this.pending;
    if (!this.dirty) return Promise.resolve(true);
    this.pending = Promise.resolve().then(async () => {
      while (this.dirty) {
        const writingRevision = this.revision;
        await write();
        this.savedRevision = writingRevision;
      }
      this.error = null;
      return true;
    }).catch((error: unknown) => {
      this.error = error;
      return false;
    }).finally(() => { this.pending = null; });
    return this.pending;
  }
}

/** Metadata and body writes share an ordered queue; a failure does not poison later retries. */
export class SerialQueue {
  private tail: Promise<unknown> = Promise.resolve();
  private foreground = 0;
  get hasPendingWrites(): boolean { return this.foreground > 0; }
  idle(): Promise<unknown> { return this.tail; }
  run<T>(work: () => Promise<T>, background = false): Promise<T> {
    if (!background) this.foreground++;
    const operation = this.tail.then(work);
    this.tail = operation.catch(() => undefined).finally(() => { if (!background) this.foreground--; });
    return operation;
  }
}
