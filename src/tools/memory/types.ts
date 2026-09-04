export interface Memory {
  id: string;
  userId: string;
  content: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface MemoryRepository {
  create(userId: string, content: string): Promise<Memory>;
  search(userId: string, query: string): Promise<Memory[]>;
}
