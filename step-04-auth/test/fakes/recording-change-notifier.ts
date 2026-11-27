import type { ChangeNotifier } from "../../src/domain/ports/notifications/change-notifier";

/** A ChangeNotifier for unit tests that only counts what it was told. */
export class RecordingChangeNotifier implements ChangeNotifier {
  resourcesChangedCount = 0;

  resourcesChanged(): void {
    this.resourcesChangedCount++;
  }
}
