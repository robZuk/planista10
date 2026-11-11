import { api } from '@/lib/api';
import type { AppNotification } from '@/types';

export async function fetchNotifications(): Promise<{ items: AppNotification[]; unread: number }> {
  const res = await api.get('/notifications');
  return { items: res.data.data, unread: res.data.unread };
}

export async function markNotificationRead(id: string): Promise<void> {
  await api.post(`/notifications/${id}/read`);
}

export async function markAllNotificationsRead(): Promise<void> {
  await api.post('/notifications/read-all');
}
