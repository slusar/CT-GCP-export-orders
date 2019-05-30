# CT-GCP-export-orders

A dockerized nodejs app for running export of orders into google bucket. Bucket names and folder lists are managed via variables.

## Environment Variables

| Name                                       | Description                                                                                   | Default Value       |
| ------------------------------------------ | --------------------------------------------------------------------------------------------- | ------------------- |
| CONFIG\_GCS\_SERVICE\_ACCOUNT_FILE         | Path to the Service Account JSON file with access to GCS. Can be mounted using /config volume | /config/gcs_sa.json |
| CONFIG\_CT\_PROJECT\_KEY                   | Mandatory. Commercetools Project Id from merchant center                                      | --                  |
| CONFIG\_CT\_CLIENT\_ID                     | Mandatory. Commercetools client id to authorize into project                                  | --                  |
| CONFIG\_CT\_CLIENT_SECRET                  | Mandatory. Commercetools client secret to authorize into project                              | --                  |
| CONFIG\_GCS\_TARGET\_BUCKET\_NAME          | Mandatory. Name of bucket for uploading result files                                          | --                  |
| CONFIG\_GCS\_TARGET\_PATH\_NAME            | Mandatory. Directory within the bucket for storing result files                               | --                  |
| CONFIG\_CT\_CSV\_TEMPLATE                  | Mandatory. PATHS to CSV Template for exported files                                           | --                  |
| CONFIG\_CT\_FILL\_ALL\_ROWS                | Indication if exported orders should have data in all rows (items,deliveries,etc.)            | false               |
| CONFIG\_CT\_CREATE\_SYNC\_ACTIONS          | Indication if for export there should be a sync file generated                                | false               |
| CONFIG\_CT\_FILE\_WITH\_TIMESTAMP          | Indication if sync generated files should contain timestamp in name                           | false               |
