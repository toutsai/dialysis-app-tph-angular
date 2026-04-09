/**
 * Mock Firestore for Standalone Mode
 * 在單機模式下模擬 Firestore API，避免錯誤
 */

// Mock DocumentReference
class MockDocumentReference {
  id: string
  path: string

  constructor(path: string, id: string) {
    this.path = path
    this.id = id
  }
}

// Mock CollectionReference
class MockCollectionReference {
  path: string
  _converter: any = null

  constructor(path: string) {
    this.path = path
  }

  withConverter(converter: any) {
    this._converter = converter
    return this
  }
}

// Mock Query
class MockQuery {
  _collection: MockCollectionReference
  _constraints: any[]

  constructor(collection: MockCollectionReference, constraints: any[] = []) {
    this._collection = collection
    this._constraints = constraints
  }
}

// Mock QuerySnapshot
class MockQuerySnapshot {
  docs: any[] = []
  empty = true
  size = 0

  forEach(callback: (doc: any) => void) {
    this.docs.forEach(callback)
  }
}

// Mock DocumentSnapshot
class MockDocumentSnapshot {
  id: string
  _data: any
  _exists: boolean

  constructor(id: string, data: any = null) {
    this.id = id
    this._data = data
    this._exists = data !== null
  }

  exists() {
    return this._exists
  }

  data() {
    return this._data
  }
}

// Mock Firestore instance
class MockFirestore {
  _type = 'firestore'
  _isStandalone = true
}

// 建立 Mock 實例
export const mockDb = new MockFirestore()

// Mock Firestore 函數
export function mockCollection(_db: any, path: string): MockCollectionReference {
  console.log(`🔇 [MockFirestore] collection('${path}') - 單機模式，返回空集合`)
  return new MockCollectionReference(path)
}

export function mockDoc(_db: any, path: string, ...pathSegments: string[]): MockDocumentReference {
  const fullPath = [path, ...pathSegments].join('/')
  const id = pathSegments[pathSegments.length - 1] || path
  console.log(`🔇 [MockFirestore] doc('${fullPath}') - 單機模式`)
  return new MockDocumentReference(fullPath, id)
}

export function mockQuery(collection: MockCollectionReference, ...constraints: any[]): MockQuery {
  return new MockQuery(collection, constraints)
}

export async function mockGetDocs(_query: any): Promise<MockQuerySnapshot> {
  console.log('🔇 [MockFirestore] getDocs() - 單機模式，返回空結果')
  return new MockQuerySnapshot()
}

export async function mockGetDoc(_docRef: any): Promise<MockDocumentSnapshot> {
  console.log('🔇 [MockFirestore] getDoc() - 單機模式，返回空結果')
  return new MockDocumentSnapshot('mock-id', null)
}

export async function mockSetDoc(_docRef: any, _data: any, _options?: any): Promise<void> {
  console.log('🔇 [MockFirestore] setDoc() - 單機模式，操作被忽略')
}

export async function mockUpdateDoc(_docRef: any, _data: any): Promise<void> {
  console.log('🔇 [MockFirestore] updateDoc() - 單機模式，操作被忽略')
}

export async function mockDeleteDoc(_docRef: any): Promise<void> {
  console.log('🔇 [MockFirestore] deleteDoc() - 單機模式，操作被忽略')
}

export async function mockAddDoc(_collectionRef: any, _data: any): Promise<MockDocumentReference> {
  console.log('🔇 [MockFirestore] addDoc() - 單機模式，返回模擬文件')
  return new MockDocumentReference('mock', `mock-${Date.now()}`)
}

// Mock query constraints
export function mockWhere(..._args: any[]) {
  return { type: 'where', args: _args }
}

export function mockOrderBy(..._args: any[]) {
  return { type: 'orderBy', args: _args }
}

export function mockLimit(_n: number) {
  return { type: 'limit', n: _n }
}

export function mockStartAfter(..._args: any[]) {
  return { type: 'startAfter', args: _args }
}

export function mockEndBefore(..._args: any[]) {
  return { type: 'endBefore', args: _args }
}

// Mock onSnapshot (realtime listeners)
export function mockOnSnapshot(_query: any, callback: (snapshot: MockQuerySnapshot) => void): () => void {
  console.log('🔇 [MockFirestore] onSnapshot() - 單機模式，返回空快照')
  // 立即呼叫一次回調，然後返回取消訂閱函數
  setTimeout(() => {
    callback(new MockQuerySnapshot())
  }, 0)
  return () => {
    console.log('🔇 [MockFirestore] onSnapshot unsubscribed')
  }
}

// Mock Timestamp
export const mockTimestamp = {
  now: () => ({ seconds: Math.floor(Date.now() / 1000), nanoseconds: 0 }),
  fromDate: (date: Date) => ({ seconds: Math.floor(date.getTime() / 1000), nanoseconds: 0 }),
}

// Mock serverTimestamp
export function mockServerTimestamp() {
  return mockTimestamp.now()
}

// Mock arrayUnion / arrayRemove
export function mockArrayUnion(..._elements: any[]) {
  return { type: 'arrayUnion', elements: _elements }
}

export function mockArrayRemove(..._elements: any[]) {
  return { type: 'arrayRemove', elements: _elements }
}

// Mock increment
export function mockIncrement(_n: number) {
  return { type: 'increment', n: _n }
}

// Mock writeBatch
export function mockWriteBatch(_db: any) {
  const operations: any[] = []
  return {
    set: (ref: any, data: any) => operations.push({ type: 'set', ref, data }),
    update: (ref: any, data: any) => operations.push({ type: 'update', ref, data }),
    delete: (ref: any) => operations.push({ type: 'delete', ref }),
    commit: async () => {
      console.log(`🔇 [MockFirestore] writeBatch.commit() - 單機模式，${operations.length} 個操作被忽略`)
    }
  }
}

// Mock runTransaction
export async function mockRunTransaction(_db: any, updateFunction: (transaction: any) => Promise<any>) {
  console.log('🔇 [MockFirestore] runTransaction() - 單機模式')
  const mockTransaction = {
    get: async (_ref: any) => new MockDocumentSnapshot('mock-id', null),
    set: (_ref: any, _data: any) => {},
    update: (_ref: any, _data: any) => {},
    delete: (_ref: any) => {},
  }
  return await updateFunction(mockTransaction)
}
