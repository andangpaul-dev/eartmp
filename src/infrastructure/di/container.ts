/**
 * Composition root (Dependency Injection container).
 *
 * This is the ONLY place that may know both a port (interface) and its concrete
 * implementation. Every other module depends on interfaces; here we wire them
 * together. In Phase 1 the container is an empty scaffold — repositories, the
 * clock, hashing, rendering, etc. are registered in the phases that build them
 * (P2+). Keeping the seam in place now means later phases plug in without
 * touching call sites.
 */

/** A lazily-constructed, memoised dependency factory. */
type Factory<T> = () => T;

export class Container {
  private readonly singletons = new Map<string, unknown>();
  private readonly factories = new Map<string, Factory<unknown>>();

  /** Register a lazily-instantiated singleton under a token. */
  register<T>(token: string, factory: Factory<T>): void {
    this.factories.set(token, factory as Factory<unknown>);
  }

  /** Resolve a previously registered token, constructing once and caching. */
  resolve<T>(token: string): T {
    if (this.singletons.has(token)) return this.singletons.get(token) as T;
    const factory = this.factories.get(token);
    if (!factory) {
      throw new Error(`No provider registered for token "${token}".`);
    }
    const instance = factory();
    this.singletons.set(token, instance);
    return instance as T;
  }

  /** True if a token has a registered provider. */
  has(token: string): boolean {
    return this.factories.has(token);
  }
}

/**
 * Build the application container. Registrations are added by later phases,
 * e.g.:
 *   container.register("ResultRepository", () => new PrismaResultRepository(getPrisma()));
 */
export function buildContainer(): Container {
  const container = new Container();
  // Phase 1: intentionally empty. Wiring is added per phase.
  return container;
}
