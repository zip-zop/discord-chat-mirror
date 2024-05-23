# Use the official Node.js 14 image as the base image
FROM node:14

# Create and change to the app directory
WORKDIR /app

# Copy package.json and package-lock.json to the working directory
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy the rest of the application code to the working directory
COPY . .

# Expose the port the app runs on
EXPOSE 3000

# Define environment variable
ENV NODE_ENV=production

# Build the application
RUN npm run build

# Command to run the application
CMD ["npm", "run", "start"]
