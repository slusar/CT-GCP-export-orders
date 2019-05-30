FROM node:8.15-alpine

# Default env. variables
ENV CONFIG_GCS_SERVICE_ACCOUNT_FILE='/config/gcs_sa.json'

VOLUME /config

# Create app directory
WORKDIR /usr/src/app

# Install app dependencies
# A wildcard is used to ensure both package.json AND package-lock.json are copied
# where available (npm@5+)
COPY package*.json ./

RUN npm install
# If you are building your code for production
# RUN npm ci --only=production

# Bundle app source
COPY . .

#add chmod for permissions to run hack
RUN ["chmod", "+x", "/usr/src/app/entrypoint.sh"]

# COPY entrypoint.sh /
ENTRYPOINT ["./entrypoint.sh"]