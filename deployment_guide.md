# AWS Lightsail Docker Deployment Guide

This guide describes how to deploy the **Enterprise AI SQL Assistant** (Frontend + Backend + MySQL database) to AWS Lightsail. It covers containerizing both the frontend and backend, managing networking/proxies, and passing sensitive configuration keys securely without leaking credentials.

---

## 🔒 Credential Security Best Practices

To prevent accidental exposure of your keys (like `GEMINI_API_KEY`, database passwords, or JDBC connection strings):

1. **`.dockerignore` files**: We have created `.dockerignore` files in both the `frontend/` and `backend/` directories. This ensures that your local `.env` files are **never** copied into the built Docker images.
2. **No Hardcoded Secrets**: Secrets are not stored in any code or Dockerfiles. They are dynamically loaded at runtime using environment variables.
3. **Environment Injection**: 
   - **Lightsail Container Services**: Secrets are entered via the AWS Console or AWS CLI directly into the container settings.
   - **Lightsail VPS (EC2/Docker Compose)**: Secrets are stored in a secure `.env` file located *only* on the VPS instance itself (not in Git).

---

## 🏗️ Architecture & Network Routing

To simplify ports and secure the application:
* The client's browser only connects to the **Frontend (Nginx)** on port `5173` (or port `80`/`443` in production).
* All API requests (`/api/v1/*`) are automatically reverse-proxied by Nginx inside the frontend container to the backend container.
* This eliminates the need to expose the backend API port (`8000`) or the MySQL port (`3306`) to the public internet, dramatically hardening security.

---

## 🚀 Option 1: Deploying via AWS Lightsail Container Services (Serverless)

AWS Lightsail Container Services is a fully managed, serverless container hosting platform. You only need to push your Docker images to a registry (like Amazon ECR or Docker Hub) and specify the configuration.

### Step 1: Build and Push Docker Images
First, build your Docker images locally and push them to a container registry (e.g., Docker Hub or AWS ECR).

```bash
# 1. Build and tag the backend image
docker build -t your-registry/mcp-backend:latest ./backend

# 2. Build and tag the frontend image (defaults VITE_API_URL to relative '/api/v1')
docker build -t your-registry/mcp-frontend:latest ./frontend

# 3. Push images to your registry
docker push your-registry/mcp-backend:latest
docker push your-registry/mcp-frontend:latest
```

> [!NOTE]
> If you are using Amazon ECR, authenticate your Docker CLI first using `aws ecr get-login-password`.

### Step 2: Create a Lightsail Container Service
1. Open the **AWS Lightsail Console**.
2. Click **Containers** -> **Create container service**.
3. Choose your capacity (Scale: 1, Size: Nano/Micro depending on your budget).

### Step 3: Configure Containers (Deployment)
In the deployment configuration, set up the containers as follows:

#### Container 1: `backend`
* **Image**: `your-registry/mcp-backend:latest`
* **Environment variables** (Add these securely in the UI):
  * `GEMINI_API_KEY`: `your_real_gemini_api_key`
  * `GEMINI_MODEL`: `gemini-2.5-flash`
  * `DATABASE_URL`: `postgresql://...` (Optional, Neon PostgreSQL for audit logs and chats)
  * `DEFAULT_JDBC_URL`: `jdbc:mysql://localhost:3306/sales` (Or your target DB URL)
  * `DEFAULT_DB_USER`: `root`
  * `DEFAULT_DB_PASSWORD`: `rootpassword`
  * `MYSQL_HOST`: `localhost`
  * `MYSQL_PORT`: `3306`
  * `MYSQL_USER`: `root`
  * `MYSQL_PASSWORD`: `rootpassword`
  * `MYSQL_DATABASE`: `sales`

#### Container 2: `db` (MySQL Dev Database)
* **Image**: `mysql:8.0`
* **Environment variables**:
  * `MYSQL_ROOT_PASSWORD`: `rootpassword`
  * `MYSQL_DATABASE`: `sales`
* *Note: For production database storage, it is highly recommended to use a managed AWS Lightsail Database instead of running MySQL in a container, to ensure data persistence.*

#### Container 3: `frontend`
* **Image**: `your-registry/mcp-frontend:latest`
* **Environment variables**:
  * `BACKEND_URL`: `localhost:8000` (Since all containers in a Lightsail deployment share the localhost network namespace)

### Step 4: Configure Public Endpoint
1. Set the **Public Endpoint** to the `frontend` container.
2. Select Port `5173` (HTTP).
3. Click **Save and deploy**.

AWS Lightsail will spin up the containers, handle networking, and provide a secure public URL (HTTPS) for your app.

---

## 🛠️ Option 2: Deploying via Docker Compose on a Lightsail VPS (Standard VM)

If you prefer using a standard virtual machine with standard Docker Compose:

### Step 1: Create a Lightsail Instance
1. Go to the Lightsail Console.
2. Click **Create Instance**.
3. Select **Linux/Unix** and the **Ubuntu** OS blueprint.
4. Choose an instance plan (e.g., $5/month plan).
5. SSH into your instance.

### Step 2: Install Docker and Docker Compose
Run the following commands on your Lightsail VPS:
```bash
sudo apt update
sudo apt install -y docker.io docker-compose
sudo systemctl enable docker
sudo systemctl start docker
```

### Step 3: Copy Files to the Server
Clone or copy only the following configuration files to your VPS instance (do not copy your local `.env` files):
* `docker-compose.yml`
* `backend/Dockerfile`, `backend/requirements.txt`, and the `backend/app/` source directory.
* `frontend/Dockerfile`, `frontend/nginx.conf.template`, `frontend/nginx.conf`, `frontend/package.json`, and the `frontend/src/` & `frontend/public/` source directories.

### Step 4: Create the `.env` File on the VPS
Create a `.env` file in the root directory on the VPS server containing your secrets:
```bash
cat << 'EOF' > .env
GEMINI_API_KEY=your_actual_gemini_api_key_here
GEMINI_MODEL=gemini-2.5-flash
DATABASE_URL=postgresql://user:password@neon-db-host/dbname
DEFAULT_JDBC_URL=jdbc:mysql://db:3306/sales
DEFAULT_DB_USER=root
DEFAULT_DB_PASSWORD=rootpassword
EOF
```

### Step 5: Start the Containers
Run Docker Compose in the directory containing `docker-compose.yml` and `.env`:
```bash
# Build and run containers in detached mode
sudo docker-compose up --build -d
```

### Step 6: Configure Lightsail Firewall
1. Go to the Lightsail Console -> **Instances** -> Click your instance -> **Networking**.
2. Under **IPv4 Firewall**, click **Add rule**.
3. Allow **Custom / TCP** on Port **`5173`** (or change `docker-compose.yml` frontend port mapping to `80:5173` if you want it on standard HTTP port `80`).
4. Access the web app using `http://<your-vps-ip>:5173`.
