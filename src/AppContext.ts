/**
 * Typed service container — the application's composition-root helper.
 *
 * CLAUDE.md §1.4: "AppContext is a simple typed service container
 * (constructor injection). No global singletons other than AppContext."
 * Services are keyed by {@link ServiceKey} instances that carry the service
 * type, so `get`/`resolve` return the exact registered type with no casts at
 * call sites.
 */

/**
 * Type-safe key for a service registration.
 *
 * Create keys via {@link ServiceKey.create}; the constructor is private so
 * key identities always originate from the composition root.
 *
 * @typeParam T - the service type the key points to.
 */
export class ServiceKey<T> {
  /**
   * Phantom type marker — never exists at runtime. Brands the key with the
   * service type `T` so resolution is fully type-safe.
   */
  declare readonly __serviceType?: T;

  private constructor(public readonly id: string) {}

  /**
   * Creates a new service key.
   *
   * @param id - stable identifier used as the registry key.
   * @returns a key carrying the service type for type-safe resolution.
   */
  public static create<T>(id: string): ServiceKey<T> {
    return new ServiceKey<T>(id);
  }
}

/**
 * Registry of application services (logger, event bus, renderers, ...).
 *
 * One instance is constructed by the composition root (`App.ts`) during boot
 * and installed as the process-wide default. Feature modules receive the
 * services they need via constructor injection.
 */
export class AppContext {
  private static defaultInstance: AppContext | null = null;

  private readonly services = new Map<string, unknown>();

  /**
   * Registers a service under its key.
   *
   * @param key - the service key.
   * @param service - the service instance.
   * @throws Error if a service is already registered under `key`.
   */
  public register<T>(key: ServiceKey<T>, service: T): void {
    if (this.services.has(key.id)) {
      throw new Error(`Service already registered: "${key.id}"`);
    }
    this.services.set(key.id, service);
  }

  /**
   * Resolves a registered service.
   *
   * @param key - the service key.
   * @returns the registered service instance.
   * @throws Error if no service is registered under `key`.
   */
  public get<T>(key: ServiceKey<T>): T {
    const service = this.services.get(key.id);
    if (service === undefined) {
      throw new Error(`Service not registered: "${key.id}"`);
    }
    // REASON: register() guarantees the stored value has the key's type.
    return service as T;
  }

  /** Alias of {@link AppContext.get} (service-locator style resolution). */
  public resolve<T>(key: ServiceKey<T>): T {
    return this.get(key);
  }

  /**
   * Resolves a registered service without throwing.
   *
   * @param key - the service key.
   * @returns the service instance, or `undefined` when not registered.
   */
  public tryGet<T>(key: ServiceKey<T>): T | undefined {
    const service = this.services.get(key.id);
    // REASON: same type guarantee as get(), without the throw.
    return service === undefined ? undefined : (service as T);
  }

  /**
   * @param key - the service key.
   * @returns whether a service is registered under `key`.
   */
  public has<T>(key: ServiceKey<T>): boolean {
    return this.services.has(key.id);
  }

  /**
   * @returns the process-wide default context, created lazily if needed.
   */
  public static getDefault(): AppContext {
    if (AppContext.defaultInstance === null) {
      AppContext.defaultInstance = new AppContext();
    }
    return AppContext.defaultInstance;
  }

  /**
   * Installs `context` as the process-wide default context.
   *
   * @param context - the context created by the composition root.
   */
  public static setDefault(context: AppContext): void {
    AppContext.defaultInstance = context;
  }
}
