import { MemoryService } from '../../../src/tools/memory/MemoryService.js';
import { MemoryTool } from '../../../src/tools/memory/MemoryTool.js';
import { InMemoryMemoryRepository } from '../../utils/InMemoryMemoryRepository.js';

describe('MemoryTool', () => {
  it('only stores explicit remember requests and can retrieve memories', async () => {
    const tool = new MemoryTool(new MemoryService(new InMemoryMemoryRepository()));
    const ctx = { userId: 'user-1', timezone: 'Africa/Dar_es_Salaam' };

    const remembered = await tool.execute({ action: 'remember', content: 'My project deadline is September 10.' }, ctx);
    expect(remembered.message).toContain('remember');

    const recalled = await tool.execute({ action: 'query', query: 'project deadline' }, ctx);
    expect(recalled.message).toContain('September 10');
  });
});
