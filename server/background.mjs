export function afterResponse(response, task) {
  return new Promise((resolve) => {
    let started = false,
      aborted = false;
    response.once('finish', () => {
      if (aborted) return;
      started = true;
      Promise.resolve()
        .then(task)
        .catch(() => {})
        .finally(resolve);
    });
    response.once('close', () => {
      if (!started) {
        aborted = true;
        resolve();
      }
    });
  });
}
