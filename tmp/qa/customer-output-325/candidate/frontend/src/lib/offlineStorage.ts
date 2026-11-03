/**
 * Offline Storage Service for Security Management
 * Handles data synchronization when offline/online
 */

interface OfflineAction {
  id: string;
  type: 'ATTENDANCE_SIGNATURE' | 'EXCEPTION_REQUEST' | 'MISSION_ASSIGNMENT';
  data: any;
  timestamp: number;
  retryCount: number;
  maxRetries: number;
}

class OfflineStorageService {
  private static instance: OfflineStorageService;
  private storageKey = 'sabalan_offline_actions';
  private syncInProgress = false;

  private constructor() {
    this.setupEventListeners();
  }

  public static getInstance(): OfflineStorageService {
    if (!OfflineStorageService.instance) {
      OfflineStorageService.instance = new OfflineStorageService();
    }
    return OfflineStorageService.instance;
  }

  private setupEventListeners() {
    // Listen for online/offline events
    window.addEventListener('online', () => {
      this.syncPendingActions();
    });

    // Periodic sync when online
    setInterval(() => {
      if (navigator.onLine && !this.syncInProgress) {
        this.syncPendingActions();
      }
    }, 30000); // Every 30 seconds
  }

  /**
   * Store action for offline execution
   */
  public storeAction(type: OfflineAction['type'], data: any): string {
    const action: OfflineAction = {
      id: this.generateId(),
      type,
      data,
      timestamp: Date.now(),
      retryCount: 0,
      maxRetries: 3
    };

    const actions = this.getStoredActions();
    actions.push(action);
    this.saveActions(actions);

    // Try to execute immediately if online
    if (navigator.onLine) {
      this.executeAction(action);
    }

    return action.id;
  }

  /**
   * Get all stored offline actions
   */
  public getStoredActions(): OfflineAction[] {
    try {
      const stored = localStorage.getItem(this.storageKey);
      return stored ? JSON.parse(stored) : [];
    } catch (error) {
      console.error('Error reading offline actions:', error);
      return [];
    }
  }

  /**
   * Get pending actions count
   */
  public getPendingActionsCount(): number {
    return this.getStoredActions().length;
  }

  /**
   * Clear all stored actions
   */
  public clearAllActions(): void {
    localStorage.removeItem(this.storageKey);
  }

  /**
   * Remove specific action
   */
  private removeAction(actionId: string): void {
    const actions = this.getStoredActions();
    const filteredActions = actions.filter(action => action.id !== actionId);
    this.saveActions(filteredActions);
  }

  /**
   * Save actions to localStorage
   */
  private saveActions(actions: OfflineAction[]): void {
    try {
      localStorage.setItem(this.storageKey, JSON.stringify(actions));
    } catch (error) {
      console.error('Error saving offline actions:', error);
    }
  }

  /**
   * Execute a single action
   */
  private async executeAction(action: OfflineAction): Promise<boolean> {
    try {
      const { securityAPI } = await import('./api');

      switch (action.type) {
        case 'ATTENDANCE_SIGNATURE':
          await securityAPI.saveAttendanceSignature(
            action.data.recordId,
            action.data.signatureData,
            action.data.signatureType
          );
          break;

        case 'EXCEPTION_REQUEST':
          await securityAPI.createExceptionRequest(action.data);
          break;

        case 'MISSION_ASSIGNMENT':
          await securityAPI.createMissionAssignment(action.data);
          break;

        default:
          console.warn('Unknown action type:', action.type);
          return false;
      }

      // Remove successful action
      this.removeAction(action.id);
      return true;

    } catch (error) {
      console.error('Error executing offline action:', error);
      
      // Increment retry count
      const actions = this.getStoredActions();
      const actionIndex = actions.findIndex(a => a.id === action.id);
      
      if (actionIndex !== -1) {
        actions[actionIndex].retryCount++;
        
        if (actions[actionIndex].retryCount >= actions[actionIndex].maxRetries) {
          // Remove action after max retries
          this.removeAction(action.id);
        } else {
          // Update retry count
          this.saveActions(actions);
        }
      }
      
      return false;
    }
  }

  /**
   * Sync all pending actions
   */
  public async syncPendingActions(): Promise<void> {
    if (this.syncInProgress || !navigator.onLine) {
      return;
    }

    this.syncInProgress = true;
    const actions = this.getStoredActions();

    console.log(`Syncing ${actions.length} offline actions...`);

    for (const action of actions) {
      await this.executeAction(action);
    }

    this.syncInProgress = false;
    console.log('Offline sync completed');
  }

  /**
   * Generate unique ID
   */
  private generateId(): string {
    return `offline_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Check if device has offline storage capability
   */
  public isOfflineCapable(): boolean {
    return 'localStorage' in window && 'serviceWorker' in navigator;
  }

  /**
   * Get storage usage info
   */
  public getStorageInfo(): { used: number; available: number } {
    try {
      let used = 0;
      for (const key in localStorage) {
        if (localStorage.hasOwnProperty(key)) {
          used += localStorage[key].length;
        }
      }
      
      // Estimate available space (5MB limit for most browsers)
      const available = 5 * 1024 * 1024 - used;
      
      return { used, available };
    } catch (error) {
      return { used: 0, available: 0 };
    }
  }
}

// Export singleton instance
export const offlineStorage = OfflineStorageService.getInstance();

// Export types
export type { OfflineAction };
