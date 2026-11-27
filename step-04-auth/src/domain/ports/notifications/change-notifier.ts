/**
 * Tells connected clients that something they may have listed has changed.
 * A notification is only a "please re-list" hint: implementations must not
 * throw, so a failed delivery can never fail the change that caused it.
 */
export interface ChangeNotifier {
  resourcesChanged(): void;
}
