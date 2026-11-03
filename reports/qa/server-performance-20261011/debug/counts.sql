BEGIN READ ONLY;
SET LOCAL statement_timeout='5s';
SELECT "destinationWorkspaceCode","sourceType",status,count(*) FROM hr_duties GROUP BY 1,2,3 ORDER BY 4 DESC LIMIT 16;
SELECT count(*) AS inquiries,sum(rows) AS inquiry_rows,max(rows) AS largest_inquiry_rows FROM (SELECT "inquiryId",count(*) AS rows FROM partner_inquiry_rows GROUP BY 1) r;
SELECT count(*) AS waiting_locks FROM pg_stat_activity WHERE wait_event_type='Lock';
ROLLBACK;

