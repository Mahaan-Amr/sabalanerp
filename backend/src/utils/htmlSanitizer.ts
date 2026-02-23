import sanitizeHtml from 'sanitize-html';

const allowedTags = [
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'p', 'div', 'span', 'strong', 'em', 'b', 'i', 'u',
  'ul', 'ol', 'li', 'br', 'hr',
  'table', 'thead', 'tbody', 'tr', 'th', 'td',
  'a'
];

const allowedAttributes: sanitizeHtml.IOptions['allowedAttributes'] = {
  '*': ['class', 'style'],
  a: ['href', 'target', 'rel']
};

const allowedSchemes = ['http', 'https', 'mailto', 'tel'];

export const sanitizeContractHtml = (unsafeHtml: string): string => {
  return sanitizeHtml(unsafeHtml || '', {
    allowedTags,
    allowedAttributes,
    allowedSchemes,
    disallowedTagsMode: 'discard'
  });
};
