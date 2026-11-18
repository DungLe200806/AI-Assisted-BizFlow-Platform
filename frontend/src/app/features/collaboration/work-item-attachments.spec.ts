import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { authInterceptor } from '../../core/auth/auth.interceptor';
import { SessionService } from '../../core/auth/session';
import { AttachmentItem, UploadSessionResult, WorkItemAttachments } from './work-item-attachments';

describe('WorkItemAttachments component', () => {
  const mockAttachments: AttachmentItem[] = [
    {
      attachmentId: 'att-1',
      objectType: 'TASK',
      objectId: 'task-100',
      uploadedBy: 'user-1',
      uploaderName: 'Alice Developer',
      uploaderEmail: 'alice@example.com',
      fileName: 'spec-architecture.pdf',
      contentType: 'application/pdf',
      sizeBytes: 1048576,
      status: 'READY',
      hash: 'a1b2c3d4e5f60718293a4b5c6d7e8f90123456789abcdef0123456789abcdef0',
      createdAt: '2026-10-07T12:00:00Z',
      isOwner: true,
      canDelete: true,
    },
    {
      attachmentId: 'att-2',
      objectType: 'TASK',
      objectId: 'task-100',
      uploadedBy: 'user-2',
      uploaderName: 'Bob Reviewer',
      uploaderEmail: 'bob@example.com',
      fileName: 'data-metrics.xlsx',
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      sizeBytes: 204800,
      status: 'READY',
      hash: 'f0e1d2c3b4a5968778695a4b3c2d1e0f0123456789abcdef0123456789abcdef',
      createdAt: '2026-10-07T12:30:00Z',
      isOwner: false,
      canDelete: false,
    },
  ];

  const tick = (ms = 35) => new Promise((resolve) => setTimeout(resolve, ms));

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [WorkItemAttachments],
      providers: [
        provideHttpClient(withInterceptors([authInterceptor])),
        provideHttpClientTesting(),
        {
          provide: SessionService,
          useValue: {
            accessToken: () => 'dev-token-role-user',
            sessionGeneration: () => 1,
            hasPermission: (perm: string) =>
              perm === 'attachments.upload' ||
              perm === 'attachments.read' ||
              perm === 'attachments.delete',
            identity: () => ({
              userId: 'user-1',
              fullName: 'Alice Developer',
              tenantId: 'tenant-1',
            }),
          },
        },
      ],
    });
  });

  afterEach(() => {
    const http = TestBed.inject(HttpTestingController);
    http.verify();
  });

  it('loads and renders attachments for the target object', () => {
    const fixture = TestBed.createComponent(WorkItemAttachments);
    fixture.componentRef.setInput('objectType', 'TASK');
    fixture.componentRef.setInput('objectId', 'task-100');
    fixture.detectChanges();

    const http = TestBed.inject(HttpTestingController);
    const req = http.expectOne((r) => r.url === '/api/v1/attachments');
    expect(req.request.params.get('objectType')).toBe('TASK');
    expect(req.request.params.get('objectId')).toBe('task-100');
    req.flush(mockAttachments);

    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Attachments & Evidence');
    expect(fixture.nativeElement.textContent).toContain('spec-architecture.pdf');
    expect(fixture.nativeElement.textContent).toContain('data-metrics.xlsx');
    expect(fixture.nativeElement.textContent).toContain('Alice Developer');
    expect(fixture.nativeElement.textContent).toContain('Bob Reviewer');
  });

  it('rejects file larger than 500 MB immediately', async () => {
    const fixture = TestBed.createComponent(WorkItemAttachments);
    fixture.componentRef.setInput('objectType', 'TASK');
    fixture.componentRef.setInput('objectId', 'task-100');
    fixture.detectChanges();

    const http = TestBed.inject(HttpTestingController);
    http.expectOne((r) => r.url === '/api/v1/attachments').flush([]);
    fixture.detectChanges();

    const oversizedFile = new File(['dummy'], 'giant.zip');
    Object.defineProperty(oversizedFile, 'size', { value: 524288001 });

    const mockInput = {
      files: [oversizedFile],
      value: 'giant.zip',
    } as unknown as HTMLInputElement;

    await fixture.componentInstance.onFileSelected(new Event('change'), mockInput);
    fixture.detectChanges();

    expect(fixture.componentInstance.error()).toContain('500 MB');
    expect(mockInput.value).toBe('');
  });

  it('handles multi-step file upload flow successfully', async () => {
    const fixture = TestBed.createComponent(WorkItemAttachments);
    fixture.componentRef.setInput('objectType', 'TASK');
    fixture.componentRef.setInput('objectId', 'task-100');
    fixture.detectChanges();

    const http = TestBed.inject(HttpTestingController);
    http.expectOne((r) => r.url === '/api/v1/attachments').flush([]);
    fixture.detectChanges();

    const testFile = new File(['sample attachment text'], 'doc.txt', { type: 'text/plain' });
    const mockInput = {
      files: [testFile],
      value: 'doc.txt',
    } as unknown as HTMLInputElement;

    const uploadPromise = fixture.componentInstance.onFileSelected(new Event('change'), mockInput);

    // 1. Session request
    await tick();
    const sessionReq = http.expectOne('/api/v1/attachments/upload-session');
    expect(sessionReq.request.method).toBe('POST');
    expect(sessionReq.request.body.fileName).toBe('doc.txt');
    const sessionResult: UploadSessionResult = {
      attachmentId: 'att-new',
      objectKey: 'tenants/123/2026/10/att-new_doc.txt',
      uploadUrl: '/api/v1/attachments/upload-session/att-new/binary',
      expiresAt: '2026-10-07T14:00:00Z',
    };
    sessionReq.flush(sessionResult);

    // 2. Binary upload PUT
    await tick();
    const putReq = http.expectOne('/api/v1/attachments/upload-session/att-new/binary');
    expect(putReq.request.method).toBe('PUT');
    putReq.flush(null, { status: 204, statusText: 'No Content' });

    // 3. Finalize POST
    await tick();
    await tick();
    const finalizeReq = http.expectOne('/api/v1/attachments/finalize');
    expect(finalizeReq.request.method).toBe('POST');
    expect(finalizeReq.request.body.attachmentId).toBe('att-new');
    const finalizedItem: AttachmentItem = {
      attachmentId: 'att-new',
      objectType: 'TASK',
      objectId: 'task-100',
      uploadedBy: 'user-1',
      uploaderName: 'Alice Developer',
      uploaderEmail: 'alice@example.com',
      fileName: 'doc.txt',
      contentType: 'text/plain',
      sizeBytes: testFile.size,
      status: 'READY',
      hash: 'abc123hash',
      createdAt: '2026-10-07T13:00:00Z',
      isOwner: true,
      canDelete: true,
    };
    finalizeReq.flush(finalizedItem);

    await uploadPromise;
    fixture.detectChanges();

    expect(fixture.componentInstance.attachments().length).toBe(1);
    expect(fixture.nativeElement.textContent).toContain('doc.txt');
  });

  it('deletes attachment when user confirms', () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    const fixture = TestBed.createComponent(WorkItemAttachments);
    fixture.componentRef.setInput('objectType', 'TASK');
    fixture.componentRef.setInput('objectId', 'task-100');
    fixture.detectChanges();

    const http = TestBed.inject(HttpTestingController);
    http.expectOne((r) => r.url === '/api/v1/attachments').flush(mockAttachments);
    fixture.detectChanges();

    fixture.componentInstance.deleteAttachment('att-1');

    const delReq = http.expectOne('/api/v1/attachments/att-1');
    expect(delReq.request.method).toBe('DELETE');
    delReq.flush(null, { status: 204, statusText: 'No Content' });
    fixture.detectChanges();

    expect(fixture.componentInstance.attachments().length).toBe(1);
    expect(fixture.componentInstance.attachments()[0].attachmentId).toBe('att-2');
  });

  it('downloads attachment via authenticated HttpClient blob request with original fileName', async () => {
    const createObjectUrlSpy = vi.spyOn(window.URL, 'createObjectURL').mockReturnValue('blob:http://localhost/test-blob');
    const revokeObjectUrlSpy = vi.spyOn(window.URL, 'revokeObjectURL').mockImplementation(() => {});
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    const fixture = TestBed.createComponent(WorkItemAttachments);
    fixture.componentRef.setInput('objectType', 'TASK');
    fixture.componentRef.setInput('objectId', 'task-100');
    fixture.detectChanges();

    const http = TestBed.inject(HttpTestingController);
    http.expectOne((r) => r.url === '/api/v1/attachments').flush(mockAttachments);
    fixture.detectChanges();

    const mockEvent = new MouseEvent('click', { cancelable: true });
    fixture.componentInstance.downloadAttachment(mockAttachments[0], mockEvent);
    expect(mockEvent.defaultPrevented).toBe(true);

    const downloadReq = http.expectOne('/api/v1/attachments/att-1/download');
    expect(downloadReq.request.method).toBe('GET');
    expect(downloadReq.request.responseType).toBe('blob');
    expect(downloadReq.request.headers.get('Authorization')).toBe('Bearer dev-token-role-user');
    downloadReq.flush(new Blob(['pdf binary content'], { type: 'application/pdf' }));

    expect(createObjectUrlSpy).toHaveBeenCalled();
    expect(clickSpy).toHaveBeenCalled();

    await tick(150);
    expect(revokeObjectUrlSpy).toHaveBeenCalledWith('blob:http://localhost/test-blob');

    createObjectUrlSpy.mockRestore();
    revokeObjectUrlSpy.mockRestore();
    clickSpy.mockRestore();
  });

  it('triggers authenticated blob download on DOM click for both .btn-download and .attachment-link in REQUEST and TASK views', async () => {
    const createObjectUrlSpy = vi.spyOn(window.URL, 'createObjectURL').mockReturnValue('blob:http://localhost/dom-blob');
    const revokeObjectUrlSpy = vi.spyOn(window.URL, 'revokeObjectURL').mockImplementation(() => {});
    const clickedDownloads: string[] = [];
    const origCreateElement = document.createElement.bind(document);
    const createElementSpy = vi.spyOn(document, 'createElement').mockImplementation((tagName: string, options?: ElementCreationOptions) => {
      const el = origCreateElement(tagName, options);
      if (tagName.toLowerCase() === 'a') {
        vi.spyOn(el as HTMLAnchorElement, 'click').mockImplementation(() => {
          clickedDownloads.push((el as HTMLAnchorElement).download);
        });
      }
      return el;
    });

    for (const objectType of ['TASK', 'REQUEST'] as const) {
      const fixture = TestBed.createComponent(WorkItemAttachments);
      fixture.componentRef.setInput('objectType', objectType);
      fixture.componentRef.setInput('objectId', 'obj-100');
      fixture.detectChanges();

      const http = TestBed.inject(HttpTestingController);
      http.expectOne((r) => r.url === '/api/v1/attachments').flush(mockAttachments);
      fixture.detectChanges();

      // Click .btn-download on first attachment
      const downloadBtn = fixture.nativeElement.querySelector('.btn-download') as HTMLAnchorElement;
      const btnEvent = new MouseEvent('click', { bubbles: true, cancelable: true });
      downloadBtn.dispatchEvent(btnEvent);
      expect(btnEvent.defaultPrevented).toBe(true);

      const req1 = http.expectOne('/api/v1/attachments/att-1/download');
      expect(req1.request.headers.get('Authorization')).toBe('Bearer dev-token-role-user');
      expect(req1.request.responseType).toBe('blob');
      req1.flush(new Blob(['pdf-bytes'], { type: 'application/pdf' }));

      // Click .attachment-link on second attachment
      const titleLinks = fixture.nativeElement.querySelectorAll('.attachment-link') as NodeListOf<HTMLAnchorElement>;
      const linkEvent = new MouseEvent('click', { bubbles: true, cancelable: true });
      titleLinks[1].dispatchEvent(linkEvent);
      expect(linkEvent.defaultPrevented).toBe(true);

      const req2 = http.expectOne('/api/v1/attachments/att-2/download');
      expect(req2.request.headers.get('Authorization')).toBe('Bearer dev-token-role-user');
      expect(req2.request.responseType).toBe('blob');
      req2.flush(new Blob(['xlsx-bytes'], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));

      fixture.destroy();
    }

    expect(clickedDownloads).toEqual([
      'spec-architecture.pdf',
      'data-metrics.xlsx',
      'spec-architecture.pdf',
      'data-metrics.xlsx',
    ]);

    await tick(150);
    createElementSpy.mockRestore();
    createObjectUrlSpy.mockRestore();
    revokeObjectUrlSpy.mockRestore();
  });
});
