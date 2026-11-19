// Muse Client half: one sidebar entry and its main panel.
//
// Lazy-CJS by contract: React comes from the platform module table; no Harness
// Client package is imported; styling uses theme tokens only.
window.__ModuleLoader__.load({
  id: '@muse-work/dsh-muse',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const { useState, useEffect, useCallback } = React;

    const STATUS_LABEL = {
      open: '待开始',
      running: '进行中',
      review: '待审核',
      completed: '已完成',
      cancelled: '已取消',
    };

    const tone = {
      bg: 'var(--dsw-alias-bg-layer-1, #17181a)',
      bgSoft: 'var(--dsw-alias-bg-layer-2, #1f2023)',
      text: 'var(--dsw-alias-label-primary, #f2f3f5)',
      dim: 'var(--dsw-alias-label-secondary, #a2a6ad)',
      line: 'var(--dsw-alias-border-l1, rgba(255,255,255,0.12))',
      accent: 'var(--dsw-alias-brand-primary, #4d8dff)',
    };

    async function request(path, init) {
      const response = await fetch(`/muse${path}`, {
        headers: init && init.body ? { 'content-type': 'application/json' } : undefined,
        ...init,
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
      return body;
    }

    function MuseIcon() {
      return h(
        'svg',
        { viewBox: '0 0 24 24', width: 18, height: 18, 'aria-hidden': true, fill: 'currentColor' },
        h('path', {
          d: 'M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v7a2.5 2.5 0 0 1-2.5 2.5H10l-4.2 3.3c-.5.4-1.3 0-1.3-.7V6.5Z',
        }),
      );
    }

    function Badge({ status }) {
      const active = status === 'running';
      return h(
        'span',
        {
          style: {
            fontSize: 11,
            padding: '1px 7px',
            borderRadius: 999,
            border: `1px solid ${active ? tone.accent : tone.line}`,
            color: active ? tone.accent : tone.dim,
            whiteSpace: 'nowrap',
          },
        },
        STATUS_LABEL[status] || status,
      );
    }

    function IssuePage() {
      const [issues, setIssues] = useState([]);
      const [selectedId, setSelectedId] = useState(null);
      const [draftOpen, setDraftOpen] = useState(false);
      const [title, setTitle] = useState('');
      const [description, setDescription] = useState('');
      const [message, setMessage] = useState('');
      const [error, setError] = useState('');
      const [busy, setBusy] = useState(false);

      const refresh = useCallback(async () => {
        try {
          const data = await request('/issues');
          setIssues(data.issues || []);
          setError('');
        } catch (err) {
          setError(err.message);
        }
      }, []);

      useEffect(() => {
        refresh();
        const timer = setInterval(refresh, 5000);
        return () => clearInterval(timer);
      }, [refresh]);

      const selected = issues.find((issue) => issue.id === selectedId) || null;

      async function run(action) {
        setBusy(true);
        setError('');
        try {
          await action();
          await refresh();
        } catch (err) {
          setError(err.message);
        } finally {
          setBusy(false);
        }
      }

      const panel = {
        display: 'flex',
        height: '100%',
        minHeight: 0,
        color: tone.text,
        background: tone.bg,
        fontSize: 13,
      };
      const listPane = {
        width: 320,
        flex: '0 0 320px',
        borderRight: `1px solid ${tone.line}`,
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
      };
      const input = {
        width: '100%',
        boxSizing: 'border-box',
        background: tone.bgSoft,
        color: tone.text,
        border: `1px solid ${tone.line}`,
        borderRadius: 8,
        padding: '7px 9px',
        fontSize: 13,
        outline: 'none',
      };
      const button = (primary) => ({
        border: `1px solid ${primary ? tone.accent : tone.line}`,
        background: primary ? tone.accent : 'transparent',
        color: primary ? '#fff' : tone.text,
        borderRadius: 8,
        padding: '6px 12px',
        cursor: busy ? 'progress' : 'pointer',
        fontSize: 13,
        opacity: busy ? 0.6 : 1,
      });

      return h(
        'div',
        { style: panel },
        h(
          'div',
          { style: listPane },
          h(
            'div',
            {
              style: {
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '14px 14px 10px',
              },
            },
            h('strong', { style: { fontSize: 14 } }, '事项'),
            h(
              'button',
              {
                style: button(false),
                onClick: () => {
                  setDraftOpen((open) => !open);
                  setError('');
                },
              },
              draftOpen ? '收起' : '新建',
            ),
          ),
          draftOpen
            ? h(
                'div',
                { style: { padding: '0 14px 12px', display: 'grid', gap: 8 } },
                h('input', {
                  style: input,
                  placeholder: '要办成什么',
                  value: title,
                  onChange: (event) => setTitle(event.target.value),
                }),
                h('textarea', {
                  style: { ...input, minHeight: 72, resize: 'vertical' },
                  placeholder: '目标、边界、怎么验收',
                  value: description,
                  onChange: (event) => setDescription(event.target.value),
                }),
                h(
                  'button',
                  {
                    style: button(true),
                    disabled: busy || !title.trim(),
                    onClick: () =>
                      run(async () => {
                        await request('/issues', {
                          method: 'POST',
                          body: JSON.stringify({ title, description }),
                        });
                        setTitle('');
                        setDescription('');
                        setDraftOpen(false);
                      }),
                  },
                  '登记',
                ),
              )
            : null,
          h(
            'div',
            { style: { overflowY: 'auto', flex: 1, minHeight: 0 } },
            issues.length === 0
              ? h(
                  'div',
                  { style: { padding: 16, color: tone.dim, lineHeight: 1.7 } },
                  '还没有事项。在 Muse 预设的会话里让 agent 建一件，或者点上面的「新建」。',
                )
              : issues.map((issue) =>
                  h(
                    'div',
                    {
                      key: issue.id,
                      onClick: () => setSelectedId(issue.id),
                      style: {
                        padding: '10px 14px',
                        borderBottom: `1px solid ${tone.line}`,
                        cursor: 'pointer',
                        background: issue.id === selectedId ? tone.bgSoft : 'transparent',
                      },
                    },
                    h(
                      'div',
                      { style: { display: 'flex', gap: 8, alignItems: 'center' } },
                      h(Badge, { status: issue.status }),
                      h(
                        'span',
                        {
                          style: {
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          },
                        },
                        issue.title,
                      ),
                    ),
                    h(
                      'div',
                      { style: { color: tone.dim, fontSize: 11, marginTop: 4 } },
                      `${issue.id} · ${issue.priority}`,
                    ),
                  ),
                ),
          ),
        ),
        h(
          'div',
          { style: { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' } },
          error
            ? h(
                'div',
                { style: { padding: '8px 18px', color: '#e5484d', borderBottom: `1px solid ${tone.line}` } },
                error,
              )
            : null,
          selected
            ? h(
                'div',
                { style: { padding: 18, overflowY: 'auto', flex: 1, minHeight: 0 } },
                h('h2', { style: { margin: '0 0 6px', fontSize: 17 } }, selected.title),
                h(
                  'div',
                  { style: { display: 'flex', gap: 10, alignItems: 'center', marginBottom: 14 } },
                  h(Badge, { status: selected.status }),
                  h('span', { style: { color: tone.dim, fontSize: 12 } }, selected.id),
                  selected.sessionId
                    ? h(
                        'span',
                        { style: { color: tone.dim, fontSize: 12 } },
                        `会话 ${selected.sessionId}`,
                      )
                    : null,
                ),
                h(
                  'div',
                  {
                    style: {
                      whiteSpace: 'pre-wrap',
                      lineHeight: 1.7,
                      color: tone.text,
                      marginBottom: 18,
                    },
                  },
                  selected.description || '（没有写目标与验收）',
                ),
                h(
                  'div',
                  { style: { display: 'grid', gap: 8, maxWidth: 720 } },
                  h('textarea', {
                    style: { ...input, minHeight: 84, resize: 'vertical' },
                    placeholder: '派活或追问：做什么、边界、怎么验收',
                    value: message,
                    onChange: (event) => setMessage(event.target.value),
                  }),
                  h(
                    'div',
                    { style: { display: 'flex', gap: 8 } },
                    h(
                      'button',
                      {
                        style: button(true),
                        disabled: busy || !message.trim(),
                        onClick: () =>
                          run(async () => {
                            await request(`/issues/${selected.id}/message`, {
                              method: 'POST',
                              body: JSON.stringify({ message }),
                            });
                            setMessage('');
                          }),
                      },
                      selected.sessionId ? '派活' : '派活并开会话',
                    ),
                    h(
                      'button',
                      {
                        style: button(false),
                        disabled: busy,
                        onClick: () =>
                          run(async () => {
                            await request(`/issues/${selected.id}/close`, {
                              method: 'POST',
                              body: JSON.stringify({ action: 'complete' }),
                            });
                          }),
                      },
                      '标记完成',
                    ),
                  ),
                  selected.sessionId
                    ? h(
                        'div',
                        { style: { color: tone.dim, fontSize: 12, marginTop: 2 } },
                        '会话在左侧会话列表里，打开就能看到它干活。',
                      )
                    : null,
                ),
              )
            : h(
                'div',
                { style: { padding: 24, color: tone.dim, lineHeight: 1.8 } },
                '左边选一件事。',
                h('br'),
                '这里只做登记和派活；改代码、跑验证由事项会话里的 agent 完成。',
              ),
        ),
      );
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.slots.inject('sidebar.panellist', () =>
          ctx.slots.register(
            { name: 'sidebar.panellist', id: 'muse', order: 50, label: 'Muse' },
            MuseIcon,
          ),
        );
        ctx.slots.inject('main', () =>
          ctx.slots.register({ name: 'main', key: 'muse' }, IssuePage),
        );
      },
    };
  },
});
