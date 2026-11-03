type RealtimePublish = (event: string, payload: unknown) => void;

let publish: RealtimePublish = () => undefined;

export const registerRealtimePublisher = (next: RealtimePublish) => {
  publish = next;
};

export const publishRealtime = (event: string, payload: unknown) => publish(event, payload);
