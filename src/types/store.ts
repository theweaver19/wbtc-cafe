// An interface of the methods that the class will have.
export interface RecordInstance<T> {
  get<K extends keyof T, V extends T[K]>(key: K): V;
  set<K extends keyof T, V extends T[K]>(key: K, value: V): this;
  merge<K extends keyof T, V extends T[K]>(
    inner:
      | Partial<T>
      | {
          [key in K]: V;
        },
  ): this;
  toJS(): any;
}
