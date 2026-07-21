export interface SessionClientMetadata {
  browser: string;
  operatingSystem: string;
  deviceCategory: string;
}

export const describeClient = (userAgent = ''): SessionClientMetadata => {
  const browser = /Edg\//i.test(userAgent) ? 'Edge'
    : /OPR\//i.test(userAgent) ? 'Opera'
      : /Chrome\//i.test(userAgent) ? 'Chrome'
        : /Firefox\//i.test(userAgent) ? 'Firefox'
          : /Safari\//i.test(userAgent) ? 'Safari'
            : 'Unknown browser';
  const operatingSystem = /iPhone|iPad|iPod/i.test(userAgent) ? 'iOS'
    : /Android/i.test(userAgent) ? 'Android'
      : /Windows/i.test(userAgent) ? 'Windows'
        : /Mac OS X|Macintosh/i.test(userAgent) ? 'macOS'
          : /Linux/i.test(userAgent) ? 'Linux'
            : 'Unknown OS';
  const deviceCategory = /iPad|Tablet/i.test(userAgent) ? 'Tablet'
    : /Mobile|iPhone|Android/i.test(userAgent) ? 'Mobile'
      : 'Desktop';
  return { browser, operatingSystem, deviceCategory };
};

export const privateNetworkLabel = (ipAddress = '') => {
  const ip = ipAddress.replace(/^::ffff:/, '');
  if (ip === '::1' || ip === '127.0.0.1' || ip.startsWith('10.') || ip.startsWith('192.168.')) return 'Internal network';
  const secondOctet = Number(ip.split('.')[1]);
  if (ip.startsWith('172.') && secondOctet >= 16 && secondOctet <= 31) return 'Internal network';
  return null;
};
