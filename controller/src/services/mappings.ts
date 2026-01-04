import type { Db, ModelMapping } from "./db";
import type { Logger } from "./logger";

// Mappings Service Interface
export interface MappingsService {
  // Public to internal name translation
  publicToInternal(publicName: string): string | null;
  internalToPublic(internalName: string): string | null;

  // Model mapping management
  addMapping(internalName: string, publicName: string): string;
  getMapping(publicName: string): ModelMapping | null;
  getAllMappings(): ModelMapping[];
  removeMapping(publicName: string): boolean;

  // Model listing
  getAvailableModels(): string[];
}

// Mappings Service Implementation
export class ModelMappingsService implements MappingsService {
  private db: Db;
  private logger: Logger;
  private cache: Map<string, ModelMapping> = new Map();
  private reverseCache: Map<string, string> = new Map();

  constructor(db: Db, logger: Logger) {
    this.db = db;
    this.logger = logger;
    this.refreshCache();
  }

  /**
   * Refresh the internal cache from the database
   */
  private refreshCache(): void {
    const mappings = this.db.getAllModelMappings();
    this.cache.clear();
    this.reverseCache.clear();

    for (const mapping of mappings) {
      this.cache.set(mapping.public_name, mapping);
      this.reverseCache.set(mapping.internal_name, mapping.public_name);
    }
  }

  /**
   * Translate a public model name to internal name
   */
  publicToInternal(publicName: string): string | null {
    // First check cache
    const mapping = this.cache.get(publicName);
    if (mapping) {
      return mapping.internal_name;
    }

    // Fallback to database lookup
    const dbMapping = this.db.getModelMapping(publicName);
    if (dbMapping) {
      this.cache.set(publicName, dbMapping);
      this.reverseCache.set(dbMapping.internal_name, publicName);
      return dbMapping.internal_name;
    }

    // If no mapping exists, assume the public name is also the internal name
    return publicName;
  }

  /**
   * Translate an internal model name to public name
   */
  internalToPublic(internalName: string): string | null {
    // First check reverse cache
    const publicName = this.reverseCache.get(internalName);
    if (publicName) {
      return publicName;
    }

    // Fallback to database lookup
    const mappings = this.db.getAllModelMappings();
    for (const mapping of mappings) {
      if (mapping.internal_name === internalName) {
        this.cache.set(mapping.public_name, mapping);
        this.reverseCache.set(mapping.internal_name, mapping.public_name);
        return mapping.public_name;
      }
    }

    // If no mapping exists, assume the internal name is also the public name
    return internalName;
  }

  /**
   * Add a new model mapping
   */
  addMapping(internalName: string, publicName: string): string {
    const id = this.db.addModelMapping(internalName, publicName);

    const mapping: ModelMapping = {
      id,
      internal_name: internalName,
      public_name: publicName,
      created_at: Date.now(),
    };

    this.cache.set(publicName, mapping);
    this.reverseCache.set(internalName, publicName);

    this.logger.modelMappingCreated(internalName, publicName);

    return id;
  }

  /**
   * Get a model mapping by public name
   */
  getMapping(publicName: string): ModelMapping | null {
    const cached = this.cache.get(publicName);
    if (cached) {
      return cached;
    }

    const dbMapping = this.db.getModelMapping(publicName);
    if (dbMapping) {
      this.cache.set(publicName, dbMapping);
      this.reverseCache.set(dbMapping.internal_name, dbMapping.public_name);
    }

    return dbMapping;
  }

  /**
   * Get all model mappings
   */
  getAllMappings(): ModelMapping[] {
    return this.db.getAllModelMappings();
  }

  /**
   * Remove a model mapping
   */
  removeMapping(publicName: string): boolean {
    const mapping = this.getMapping(publicName);
    if (!mapping) {
      return false;
    }

    // Note: The database doesn't have a delete method, so we just clear from cache
    // In a real implementation, you'd want to add a delete method to the database
    this.cache.delete(publicName);
    this.reverseCache.delete(mapping.internal_name);

    return true;
  }

  /**
   * Get list of available public model names
   */
  getAvailableModels(): string[] {
    const mappings = this.db.getAllModelMappings();
    return mappings.map((m) => m.public_name);
  }
}
