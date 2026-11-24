import { act, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { AssistantProvider, useAssistant } from '../features/assistant/AssistantProvider';
import type { AssistantService } from '../features/assistant/assistant.service';
import type { AssistantConversation, AssistantConversationDetail, AssistantReply, AssistantAttachment } from '../features/assistant/assistant.types';

const deferred = <T,>() => { let resolve!: (value: T) => void; let reject!: (error: Error) => void; const promise = new Promise<T>((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const conversation = (id: string): AssistantConversation => ({ id, title: id, status: 'ACTIVE', last_message_at: '2026-11-24T00:00:00Z', message_count: 0, created_at: '2026-11-24T00:00:00Z', updated_at: '2026-11-24T00:00:00Z' });
const detail = (id: string): AssistantConversationDetail => ({ ...conversation(id), messages: [], attachments: [] });
const attachment: AssistantAttachment = { id: 'upload-A', source: 'TEMPORARY_UPLOAD', original_name: 'qa.pdf', mime_type: 'application/pdf', size_bytes: 10, status: 'AVAILABLE', created_at: '2026-11-24T00:00:00Z' };
const service = (overrides: Partial<AssistantService> = {}): AssistantService => ({
  getSuggestions: vi.fn(async () => []), listConversations: vi.fn(async () => []), getConversation: vi.fn(async id => detail(id)),
  createConversation: vi.fn(async () => conversation('A')), sendMessage: vi.fn(async (): Promise<AssistantReply> => ({ status: 'idle', message: 'OK' })),
  confirmAction: vi.fn(async (): Promise<AssistantReply> => ({ status: 'success' })), submitCollection: vi.fn(async (): Promise<AssistantReply> => ({ status: 'idle' })),
  dismissSuggestion: vi.fn(async () => undefined), snoozeSuggestion: vi.fn(async () => undefined),
  renameConversation: vi.fn(async (id, title) => ({ ...conversation(id), title })),
  archiveConversation: vi.fn(async id => ({ ...conversation(id), status: 'ARCHIVED' as const })),
  trashConversation: vi.fn(async id => ({ ...conversation(id), status: 'TRASHED' as const })), restoreConversation: vi.fn(async id => conversation(id)),
  uploadAttachment: vi.fn(async () => attachment), archiveAttachment: vi.fn(async () => ({ ...attachment, status: 'ARCHIVED' as const })),
  transcribeAttachment: vi.fn(async () => ({ attachmentId: attachment.id, transcript: 'Audio anterior' })), ...overrides,
});
let assistant: ReturnType<typeof useAssistant>;
function Probe() { assistant = useAssistant(); return <output data-testid="state">{JSON.stringify({ id: assistant.activeConversationId, messages: assistant.messages, uploads: assistant.pendingAttachments, draft: assistant.draft, confirmation: assistant.confirmation, status: assistant.status, scope: assistant.conversationScope, conversations: assistant.conversations, error: assistant.errorMessage })}</output>; }
function setup(api: AssistantService) { render(<MemoryRouter><AssistantProvider service={api}><Probe /></AssistantProvider></MemoryRouter>); }
const file = () => new File(['synthetic'], 'qa.pdf', { type: 'application/pdf' });

describe('Conversation isolation under delayed responses', () => {
  it('cannot send to the previous chat while the requested chat is still loading',async()=>{
    const pending=deferred<AssistantConversationDetail>();const api=service({getConversation:vi.fn(id=>id==='B'?pending.promise:Promise.resolve(detail(id)))});setup(api);
    await act(async()=>assistant.selectConversation('A'));
    let selecting!:Promise<void>;act(()=>{selecting=assistant.selectConversation('B');});
    expect(assistant.activeConversationId).toBe('B');expect(assistant.status).toBe('processing');
    await act(async()=>assistant.sendMessage('No debe enviarse a A'));expect(api.sendMessage).not.toHaveBeenCalled();
    await act(async()=>{pending.resolve(detail('B'));await selecting;});
    await act(async()=>assistant.sendMessage('Consulta en B'));expect(api.sendMessage).toHaveBeenCalledWith(expect.objectContaining({conversationId:'B'}),expect.anything());
  });
  it('a failed selection is retryable and cannot leave the old conversation active',async()=>{
    const api=service({getConversation:vi.fn(async()=>{throw Error('offline');})});setup(api);
    await act(async()=>assistant.selectConversation('B'));
    expect(assistant.status).toBe('error');expect(assistant.activeConversationId).toBeUndefined();expect(assistant.errorMessage).toContain('abrir');
  });
  it('ignores a previous chat reply even if transport ignores abort', async () => {
    const reply = deferred<AssistantReply>(); setup(service({ sendMessage: vi.fn(() => reply.promise) }));
    await act(async () => assistant.selectConversation('A'));
    let sending!: Promise<void>; act(() => { sending = assistant.sendMessage('Ayúdame con el expediente'); });
    await waitFor(() => expect(assistant.status).toBe('thinking'));
    await act(async () => assistant.selectConversation('B'));
    await act(async () => { reply.resolve({ status: 'success', message: 'Respuesta de A', conversationId: 'A', confirmation: { id: 'old', title: 'Anterior', details: [] } }); await sending; });
    expect(assistant.activeConversationId).toBe('B'); expect(assistant.messages).toEqual([]); expect(assistant.confirmation).toBeNull(); expect(assistant.status).toBe('idle');
  });
  it('a late creation cannot replace an explicitly new chat', async () => {
    const created = deferred<AssistantConversation>(); const api = service({ createConversation: vi.fn(() => created.promise) }); setup(api);
    let sending!: Promise<void>; act(() => { sending = assistant.sendMessage('Nueva cotización'); });
    act(() => assistant.newConversation());
    await act(async () => { created.resolve(conversation('A')); await sending; });
    expect(assistant.activeConversationId).toBeUndefined(); expect(assistant.status).toBe('idle'); expect(api.sendMessage).not.toHaveBeenCalled();
  });
  it('a late uploaded file stays in its original chat', async () => {
    const uploaded = deferred<AssistantAttachment>(); setup(service({ uploadAttachment: vi.fn(() => uploaded.promise) }));
    await act(async () => assistant.selectConversation('A'));
    let uploading!: Promise<void>; act(() => { uploading = assistant.uploadAttachment(file()); });
    await act(async () => assistant.selectConversation('B'));
    await act(async () => { uploaded.resolve(attachment); await uploading; });
    expect(assistant.activeConversationId).toBe('B'); expect(assistant.pendingAttachments).toEqual([]); expect(assistant.status).toBe('idle');
  });
  it('does not transfer a delayed transcription into the next draft', async () => {
    const audio = deferred<{ attachmentId: string; transcript: string }>(); const api = service({ transcribeAttachment: vi.fn(() => audio.promise) }); setup(api);
    await act(async () => assistant.selectConversation('A'));
    let transcribing!: Promise<void>; act(() => { transcribing = assistant.transcribeAudio(file()); });
    await waitFor(() => expect(api.transcribeAttachment).toHaveBeenCalled());
    act(() => assistant.newConversation()); act(() => assistant.setDraft('Borrador de B'));
    await act(async () => { audio.resolve({ attachmentId: attachment.id, transcript: 'Texto de A' }); await transcribing; });
    expect(assistant.draft).toBe('Borrador de B'); expect(assistant.pendingAttachments).toEqual([]);
  });
  it('the latest selection wins and an old error does not replace its state', async () => {
    const old = deferred<AssistantConversationDetail>(); setup(service({ getConversation: vi.fn(id => id === 'A' ? old.promise : Promise.resolve(detail(id))) }));
    let selecting!: Promise<void>; act(() => { selecting = assistant.selectConversation('A'); });
    await act(async () => assistant.selectConversation('B'));
    await act(async () => { old.reject(new Error('late error')); await selecting; });
    expect(assistant.activeConversationId).toBe('B'); expect(assistant.errorMessage).toBeUndefined();
  });
  it('history tabs preserve the latest requested scope', async () => {
    const old = deferred<AssistantConversation[]>(); setup(service({ listConversations: vi.fn(scope => scope === 'ACTIVE' ? old.promise : Promise.resolve([{ ...conversation('T'), status: 'TRASHED' as const }])) }));
    let loading!: Promise<void>; act(() => { loading = assistant.loadConversations('ACTIVE'); });
    await act(async () => assistant.loadConversations('TRASHED'));
    await act(async () => { old.resolve([conversation('A')]); await loading; });
    expect(assistant.conversationScope).toBe('TRASHED'); expect(assistant.conversations[0].id).toBe('T');
  });
  it('trashing A after switching to B does not clear B', async () => {
    const trashed = deferred<AssistantConversation>(); setup(service({ trashConversation: vi.fn(() => trashed.promise) }));
    await act(async () => assistant.selectConversation('A'));
    let trashing!: Promise<void>; act(() => { trashing = assistant.trashConversation('A'); });
    await act(async () => assistant.selectConversation('B')); act(() => assistant.setDraft('No perder'));
    await act(async () => { trashed.resolve({ ...conversation('A'), status: 'TRASHED' }); await trashing; });
    expect(assistant.activeConversationId).toBe('B'); expect(assistant.draft).toBe('No perder');
  });
  it('new chat retires pending temporary uploads in A, never in B', async () => {
    const api = service(); setup(api); await act(async () => assistant.uploadAttachment(file()));
    act(() => assistant.newConversation()); expect(api.archiveAttachment).toHaveBeenCalledWith('A', attachment.id); expect(assistant.pendingAttachments).toEqual([]);
  });
  it('reports rename and trash failures without unhandled rejections', async () => {
    setup(service({ renameConversation: vi.fn(async () => { throw Error('offline'); }), trashConversation: vi.fn(async () => { throw Error('offline'); }) }));
    await act(async () => assistant.selectConversation('A'));
    await act(async () => assistant.renameConversation('A', 'Renombrada')); expect(assistant.errorMessage).toContain('nombre');
    await act(async () => assistant.trashConversation('A')); expect(assistant.errorMessage).toContain('estado'); expect(assistant.activeConversationId).toBe('A');
  });
  it('a restore finishing after a tab change reconsults the current tab, not the old scope', async () => {
    const restored = deferred<AssistantConversation>(); const api = service({ restoreConversation: vi.fn(() => restored.promise) }); setup(api);
    await act(async () => assistant.loadConversations('TRASHED'));
    let restoring!: Promise<void>; act(() => { restoring = assistant.restoreConversation('A'); });
    await act(async () => assistant.loadConversations('ACTIVE'));
    await act(async () => { restored.resolve(conversation('A')); await restoring; });
    expect(api.listConversations).toHaveBeenLastCalledWith('ACTIVE'); expect(assistant.conversationScope).toBe('ACTIVE');
  });
});
