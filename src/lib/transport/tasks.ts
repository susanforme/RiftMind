import type { Task, MaintenanceResult } from '../../generated/contracts';
import { transport } from '../../app/runtime';
export async function awaitMaintenance(task: Task): Promise<MaintenanceResult> {
  let current = task;
  while (current.state === 'queued' || current.state === 'running') {
    await new Promise(resolve => setTimeout(resolve, 100));
    current = await transport.call('get_task_status', { id: task.id });
  }
  if (current.error) throw current.error;
  if (!current.result) throw { code: 'CANCELLED', params: {}, requestId: current.id };
  return current.result;
}
