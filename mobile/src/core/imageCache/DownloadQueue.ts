import { File } from 'expo-file-system';

export class CancelledError extends Error {
  constructor() {
    super('Descarga cancelada');
  }
}

type Job = {
  url: string;
  dest: File;
  resolve: (file: File) => void;
  reject: (e: unknown) => void;
  controller: AbortController;
  started: boolean;
};

/**
 * Cola de descargas con CONCURRENCIA LIMITADA y orden LIFO.
 *
 * - Concurrencia limitada (4): si el usuario hace scroll rápido no abrimos 50
 *   conexiones a la vez (saturan la red y la memoria). Las demás esperan en cola.
 * - LIFO (la última pedida sale primero): al hacer scroll, la imagen pedida más
 *   recientemente es la que está entrando a pantalla; las viejas probablemente ya salieron.
 * - Cancelación: si la descarga aún está en cola, se saca sin costo; si ya empezó,
 *   se aborta la petición nativa (AbortController -> el SO cierra la conexión).
 *
 * La transferencia la hace código nativo y escribe directo a disco:
 * los bytes de la imagen nunca pasan por el hilo de JavaScript.
 */
export class DownloadQueue {
  private queue: Job[] = [];
  private active = 0;

  constructor(private readonly maxConcurrent = 4) {}

  enqueue(url: string, dest: File): { promise: Promise<File>; cancel: () => void } {
    let job!: Job;
    const promise = new Promise<File>((resolve, reject) => {
      job = { url, dest, resolve, reject, controller: new AbortController(), started: false };
    });
    this.queue.push(job);
    this.pump();

    const cancel = () => {
      if (!job.started) {
        // Aún en cola: se quita sin haber gastado red.
        this.queue = this.queue.filter((j) => j !== job);
        job.reject(new CancelledError());
      } else {
        job.controller.abort(); // en curso: aborta la transferencia nativa
      }
    };
    return { promise, cancel };
  }

  get pending() {
    return { queued: this.queue.length, active: this.active };
  }

  private pump() {
    while (this.active < this.maxConcurrent && this.queue.length > 0) {
      const job = this.queue.pop()!; // LIFO
      this.run(job);
    }
  }

  private async run(job: Job) {
    job.started = true;
    this.active += 1;
    try {
      const task = File.createDownloadTask(job.url, job.dest, { signal: job.controller.signal });
      const file = await task.downloadAsync();
      if (!file) throw new Error('La descarga terminó sin archivo');
      job.resolve(file);
    } catch (e) {
      // Si se abortó, el archivo .part pudo quedar a medias: se borra.
      if (job.dest.exists) job.dest.delete();
      job.reject(job.controller.signal.aborted ? new CancelledError() : e);
    } finally {
      this.active -= 1;
      this.pump();
    }
  }
}
