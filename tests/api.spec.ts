import { test, expect } from '@playwright/test';

const BASE = 'https://garten.infinityspace42.de';

test.describe('API Endpoints - Health & Basics', () => {
  test('GET /api/health returns ok', async ({ request }) => {
    const res = await request.get(`${BASE}/api/health`);
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.status).toBe('ok');
    expect(body.service).toBe('voigt-garten-pi');
  });

  test('GET /api/gallery returns items array', async ({ request }) => {
    const res = await request.get(`${BASE}/api/gallery`);
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body).toHaveProperty('items');
    expect(body).toHaveProperty('total');
    expect(Array.isArray(body.items)).toBeTruthy();
  });

  test('GET /api/bookings returns bookings', async ({ request }) => {
    const res = await request.get(`${BASE}/api/bookings`);
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body).toHaveProperty('bookings');
  });

  test('GET /api/livestream/cameras returns cameras', async ({ request }) => {
    const res = await request.get(`${BASE}/api/livestream/cameras`);
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body).toHaveProperty('cameras');
  });
});

test.describe('API Endpoints - Unified Tasks', () => {
  test('GET /api/tasks/unified returns tasks with new fields', async ({ request }) => {
    const res = await request.get(`${BASE}/api/tasks/unified`);
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body).toHaveProperty('tasks');
    expect(body).toHaveProperty('filters');
    expect(body.tasks.length).toBeGreaterThan(0);

    // Check that tasks have the new computed fields
    const projectTask = body.tasks.find((t: any) => t.task_type === 'project');
    if (projectTask) {
      expect(projectTask).toHaveProperty('comment_count');
      expect(projectTask).toHaveProperty('children_count');
      expect(projectTask).toHaveProperty('has_blockers');
      // New fields should exist (may be null)
      expect('parent_task_id' in projectTask).toBeTruthy();
      expect('start_date' in projectTask).toBeTruthy();
      expect('due_date' in projectTask).toBeTruthy();
      expect('dependencies' in projectTask).toBeTruthy();
      expect('assigned_to_list' in projectTask).toBeTruthy();
    }
  });

  test('GET /api/tasks/unified?search=Rasen filters by text', async ({ request }) => {
    const res = await request.get(`${BASE}/api/tasks/unified?search=Rasen`);
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    // All returned tasks should match "Rasen" in title or description
    for (const task of body.tasks) {
      const match = (task.title + ' ' + (task.description || '')).toLowerCase().includes('rasen');
      expect(match).toBeTruthy();
    }
  });

  test('GET /api/tasks/unified?search=%23<id> searches by ID prefix', async ({ request }) => {
    // First get a project to know a valid ID
    const all = await request.get(`${BASE}/api/tasks/unified`);
    const allBody = await all.json();
    const project = allBody.tasks.find((t: any) => t.task_type === 'project');
    if (!project) return; // Skip if no projects

    // %23 = '#' - Flask decodes this to '#<id>'
    const res = await request.get(`${BASE}/api/tasks/unified?search=${encodeURIComponent('#' + project.id)}`);
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    // Should find at least the project with that ID
    const found = body.tasks.find((t: any) => t.id === project.id);
    expect(found).toBeTruthy();
  });

  test('GET /api/tasks/unified?priority=hoch filters by priority', async ({ request }) => {
    const res = await request.get(`${BASE}/api/tasks/unified?priority=hoch`);
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    for (const task of body.tasks) {
      if (task.task_type === 'project') {
        expect(task.priority).toBe('hoch');
      }
    }
  });

  test('GET /api/tasks/unified?sort=title&order=asc sorts correctly', async ({ request }) => {
    const res = await request.get(`${BASE}/api/tasks/unified?sort=title&order=asc`);
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    if (body.tasks.length >= 2) {
      const titles = body.tasks.map((t: any) => t.title.toLowerCase());
      for (let i = 1; i < titles.length; i++) {
        expect(titles[i] >= titles[i - 1]).toBeTruthy();
      }
    }
  });
});

test.describe('API Endpoints - Assignees', () => {
  test('GET /api/assignees returns combined list', async ({ request }) => {
    const res = await request.get(`${BASE}/api/assignees`);
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body).toHaveProperty('assignees');
    expect(Array.isArray(body.assignees)).toBeTruthy();

    // Each assignee should have required fields
    for (const a of body.assignees) {
      expect(a).toHaveProperty('id');
      expect(a).toHaveProperty('name');
      expect(a).toHaveProperty('type');
      expect(['user', 'provider']).toContain(a.type);
    }
  });
});

test.describe('API Endpoints - Service Providers', () => {
  test('GET /api/service-providers returns list', async ({ request }) => {
    const res = await request.get(`${BASE}/api/service-providers`);
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body).toHaveProperty('providers');
    expect(Array.isArray(body.providers)).toBeTruthy();
  });

  test('POST /api/service-providers requires auth', async ({ request }) => {
    const res = await request.post(`${BASE}/api/service-providers`, {
      data: { name: 'Test', category: 'Elektriker' }
    });
    expect(res.status()).toBe(401);
  });
});

test.describe('API Endpoints - Comments (unauthenticated)', () => {
  test('GET /api/tasks/project/1/comments returns comments array', async ({ request }) => {
    // Get a valid project ID first
    const all = await request.get(`${BASE}/api/tasks/unified`);
    const allBody = await all.json();
    const project = allBody.tasks.find((t: any) => t.task_type === 'project');
    if (!project) return;

    const res = await request.get(`${BASE}/api/tasks/project/${project.id}/comments`);
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body).toHaveProperty('comments');
    expect(Array.isArray(body.comments)).toBeTruthy();
  });

  test('POST /api/tasks/project/1/comments requires auth', async ({ request }) => {
    const res = await request.post(`${BASE}/api/tasks/project/1/comments`, {
      data: { comment: 'test' }
    });
    expect(res.status()).toBe(401);
  });
});

test.describe('API Endpoints - Subtasks (unauthenticated)', () => {
  test('GET /api/projects/<id>/subtasks returns subtasks', async ({ request }) => {
    const all = await request.get(`${BASE}/api/tasks/unified`);
    const allBody = await all.json();
    const project = allBody.tasks.find((t: any) => t.task_type === 'project');
    if (!project) return;

    const res = await request.get(`${BASE}/api/projects/${project.id}/subtasks`);
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body).toHaveProperty('subtasks');
    expect(Array.isArray(body.subtasks)).toBeTruthy();
  });

  test('GET /api/projects/<id>/subtasks?recursive=true returns nested', async ({ request }) => {
    const all = await request.get(`${BASE}/api/tasks/unified`);
    const allBody = await all.json();
    const project = allBody.tasks.find((t: any) => t.task_type === 'project');
    if (!project) return;

    const res = await request.get(`${BASE}/api/projects/${project.id}/subtasks?recursive=true`);
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body).toHaveProperty('subtasks');
  });
});

test.describe('API Endpoints - Blockers (unauthenticated)', () => {
  test('GET /api/projects/<id>/blockers returns blockers', async ({ request }) => {
    const all = await request.get(`${BASE}/api/tasks/unified`);
    const allBody = await all.json();
    const project = allBody.tasks.find((t: any) => t.task_type === 'project');
    if (!project) return;

    const res = await request.get(`${BASE}/api/projects/${project.id}/blockers`);
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body).toHaveProperty('blockers');
    expect(Array.isArray(body.blockers)).toBeTruthy();
  });
});

test.describe('API Endpoints - Recurring Tasks', () => {
  test('GET /api/recurring-tasks returns tasks with status', async ({ request }) => {
    const res = await request.get(`${BASE}/api/recurring-tasks`);
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body).toHaveProperty('tasks');
    expect(body.tasks.length).toBeGreaterThan(0);

    for (const task of body.tasks) {
      expect(['overdue', 'due-soon', 'ok']).toContain(task.status);
    }
  });
});

test.describe('API Endpoints - Projects', () => {
  test('GET /api/projects returns projects', async ({ request }) => {
    const res = await request.get(`${BASE}/api/projects`);
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body).toHaveProperty('projects');
    expect(Array.isArray(body.projects)).toBeTruthy();
  });

  test('PATCH /api/projects/<id> requires auth', async ({ request }) => {
    const res = await request.patch(`${BASE}/api/projects/1`, {
      data: { status: 'offen' }
    });
    expect(res.status()).toBe(401);
  });
});
