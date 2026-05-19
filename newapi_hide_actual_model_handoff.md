# New API 隐藏“实际模型”字段修改记录与交接文档

## 1. 背景

我在使用 **New API** 搭建 AI API 中转服务，服务器域名/服务是：

```text
nassaapi.xyz
```

我的目标是把底层真实模型：

```text
mimo-v2.5-pro
```

通过 New API 的模型重定向，对外伪装成：

```text
deepseek-v4-pro
```

客户请求 `deepseek-v4-pro`，实际由系统调用 `mimo-v2.5-pro`。

---

## 2. 最初提出的问题

我主要提出了以下问题：

1. **New API 系统设置里有没有开关可以隐藏日志里的“实际模型”字段？**

   因为 New API 使用日志里会同时显示：

   ```text
   请求并计费模型：deepseek-v4-pro
   实际模型：mimo-v2.5-pro
   ```

2. **如果没有开关，能不能限制普通用户只看到请求模型，看不到实际模型？**

3. **有没有办法不给客户 New API 后台账号，但让客户查看自己的用量/账单？**

4. 后来我给出了原项目地址：

   ```text
   https://github.com/QuantumNous/new-api
   ```

   希望判断具体应该如何修改。

5. 后续排查发现，服务器上实际运行的镜像是：

   ```text
   calciumion/new-api:latest
   ```

   因此实际修改时应优先基于 **Calcium-Ion/new-api** 源码，避免和当前运行版本产生差异。

6. 我还询问了：

   **修改以后，之前的用户、余额、Key、日志、渠道配置会不会丢？应该怎么备份？**

---

## 3. 技术结论

当前 New API 没有找到现成的系统开关，可以只对普通用户隐藏日志里的“实际模型”。

普通用户日志后端会走类似函数：

```go
func formatUserLogs(logs []*Log, startIdx int)
```

这个函数已经会做部分脱敏，例如删除：

```go
delete(otherMap, "admin_info")
delete(otherMap, "stream_status")
```

但是目前没有删除模型映射相关字段：

```go
is_model_mapped
upstream_model_name
```

前端会根据这些字段显示 Actual Model / 实际模型。

因此关键修复方式是：

**在后端普通用户日志脱敏逻辑中删除 `is_model_mapped` 和 `upstream_model_name`。**

这样普通用户即使打开浏览器开发者工具查看接口返回，也看不到真实上游模型名。

---

## 4. 建议补丁

需要修改文件：

```text
model/log.go
```

找到：

```go
delete(otherMap, "stream_status")
```

在下面添加：

```go
delete(otherMap, "is_model_mapped")
delete(otherMap, "upstream_model_name")
```

目标效果类似：

```go
if otherMap != nil {
    delete(otherMap, "admin_info")
    // delete(otherMap, "reject_reason")
    delete(otherMap, "stream_status")

    // Hide upstream/model-mapping details from normal users.
    delete(otherMap, "is_model_mapped")
    delete(otherMap, "upstream_model_name")
}
```

说明：

- 普通用户日志响应中不再包含真实模型字段。
- 管理员日志一般不走普通用户的 `formatUserLogs()` 脱敏逻辑，因此管理员仍应可以看到完整日志。
- 前端隐藏只能作为辅助，真正安全的做法是后端脱敏。

---

## 5. 当前服务器情况

服务器 SSH 当前使用 root 用户。

`docker ps` 显示 New API 是 Docker Compose 部署：

```text
CONTAINER ID   IMAGE                       NAMES
ecd611592bb6   calciumion/new-api:latest   newapi_saz7-new-api-1
9b98a58d0017   redis:latest                newapi_saz7-redis-1
479a6a1e8c14   mysql:8.2                   newapi_saz7-mysql-1
```

New API 容器端口：

```text
0.0.0.0:3000->3000/tcp
```

容器名称：

```text
New API：newapi_saz7-new-api-1
Redis：newapi_saz7-redis-1
MySQL：newapi_saz7-mysql-1
```

---

## 6. MySQL 信息

通过命令：

```bash
docker inspect newapi_saz7-mysql-1 | grep -i MYSQL
```

查到了：

```text
MYSQL_DATABASE=new-api
MYSQL_ROOT_PASSWORD=eZ1rW9jR6mU6uP4b
```

MySQL 数据目录挂载在宿主机：

```text
/www/dk_project/dk_app/newapi/newapi_SAz7/mysql_data
```

这说明：

用户、余额、Key、渠道、日志等数据主要在 MySQL 数据库中，不在 New API 应用容器里。

只要不删除 MySQL 数据目录、不执行删除数据卷的命令，之前用户数据一般不会丢。

---

## 7. docker-compose.yml 位置与内容

通过命令：

```bash
find /www/dk_project/dk_app/newapi -name "docker-compose.yml" 2>/dev/null
```

找到了：

```text
/www/dk_project/dk_app/newapi/newapi_SAz7/docker-compose.yml
```

当前 `docker-compose.yml` 核心内容如下：

```yaml
services:
  new-api:
    image: calciumion/new-api:${VERSION}
    restart: always
    command: --log-dir /app/logs
    ports:
      - ${HOST_IP}:${WEB_HTTP_PORT}:3000
    volumes:
      - ${APP_PATH}/data:/data
      - ${APP_PATH}/logs:/app/logs
    environment:
      - SQL_DSN=root:eZ1rW9jR6mU6uP4b@tcp(mysql:3306)/new-api
      - REDIS_CONN_STRING=redis://redis
      - SESSION_SECRET=${SESSION_SECRET}
      - TZ=Asia/Shanghai
    depends_on:
      - redis
      - mysql
    networks:
      - baota_net

  redis:
    image: redis:latest
    restart: always
    networks:
      - baota_net

  mysql:
    image: mysql:8.2
    restart: always
    environment:
      MYSQL_ROOT_PASSWORD: eZ1rW9jR6mU6uP4b
      MYSQL_DATABASE: new-api
    volumes:
      - ${APP_PATH}/mysql_data:/var/lib/mysql
    networks:
      - baota_net

networks:
  baota_net:
    external: true
```

---

## 8. 已经做过的备份

已经备份了 MySQL 数据目录，文件显示：

```text
-rw-r--r-- 1 root root 26M May 2 18:53 newapi_mysql_data_2026-05-02_185248.tar.gz
```

已经备份了 compose 文件：

```text
/www/dk_project/dk_app/newapi/newapi_SAz7/docker-compose.yml.bak_2026-05-02_185546
```

建议再补做 SQL 逻辑备份，命令是：

```bash
mkdir -p ~/newapi_backup
docker exec newapi_saz7-mysql-1 mysqldump -uroot -peZ1rW9jR6mU6uP4b new-api > ~/newapi_backup/newapi_mysql_$(date +%F_%H%M%S).sql
ls -lh ~/newapi_backup
```

注意：

```bash
-peZ1rW9jR6mU6uP4b
```

`-p` 和密码之间不能有空格。

---

## 9. 接下来需要完成的步骤

### 9.1 确认 SQL 备份存在

执行：

```bash
ls -lh ~/newapi_backup
```

如果没有 `.sql` 文件，执行：

```bash
docker exec newapi_saz7-mysql-1 mysqldump -uroot -peZ1rW9jR6mU6uP4b new-api > ~/newapi_backup/newapi_mysql_$(date +%F_%H%M%S).sql
ls -lh ~/newapi_backup
```

---

### 9.2 拉取 Calcium-Ion 源码

因为当前运行镜像是：

```text
calciumion/new-api:latest
```

所以优先使用这个仓库：

```bash
cd /www/wwwroot
git clone https://github.com/Calcium-Ion/new-api.git nassa-new-api-hide-model
cd nassa-new-api-hide-model
```

---

### 9.3 修改后端日志脱敏逻辑

编辑：

```bash
nano model/log.go
```

找到：

```go
delete(otherMap, "stream_status")
```

在下面添加：

```go
delete(otherMap, "is_model_mapped")
delete(otherMap, "upstream_model_name")
```

确认修改：

```bash
grep -n "stream_status\|is_model_mapped\|upstream_model_name" model/log.go
```

---

### 9.4 构建自定义镜像

执行：

```bash
cd /www/wwwroot/nassa-new-api-hide-model
docker build -t nassa-new-api:hide-model .
```

确认镜像存在：

```bash
docker images | grep nassa-new-api
```

---

### 9.5 修改 docker-compose.yml

进入 compose 目录：

```bash
cd /www/dk_project/dk_app/newapi/newapi_SAz7
```

编辑：

```bash
nano docker-compose.yml
```

只修改 `new-api` 服务的 image。

原来是：

```yaml
image: calciumion/new-api:${VERSION}
```

改成：

```yaml
image: nassa-new-api:hide-model
```

不要动：

- MySQL 配置
- Redis 配置
- volumes
- environment
- networks

确认：

```bash
grep -n "image:" docker-compose.yml
```

应该看到：

```text
image: nassa-new-api:hide-model
image: redis:latest
image: mysql:8.2
```

---

### 9.6 重启服务

在 compose 目录执行：

```bash
docker compose up -d
```

不要执行：

```bash
docker compose down -v
```

也不要执行：

```bash
docker volume prune
```

因为 `-v` 或 prune 可能删除数据卷。

---

### 9.7 验证服务

查看容器：

```bash
docker ps
```

看日志：

```bash
docker logs --tail=100 newapi_saz7-new-api-1
```

确认服务健康后，普通用户请求一次 `deepseek-v4-pro`，然后查看使用日志。

普通用户日志里应该只看到：

```text
请求并计费模型：deepseek-v4-pro
```

不应该看到：

```text
实际模型：mimo-v2.5-pro
upstream_model_name
is_model_mapped
```

也建议在浏览器 F12 网络请求返回里搜索：

```text
mimo-v2.5-pro
upstream_model_name
is_model_mapped
```

普通用户响应里不应出现。

---

## 10. 出问题时的恢复方法

如果新镜像启动失败，恢复 compose：

```bash
cd /www/dk_project/dk_app/newapi/newapi_SAz7
cp docker-compose.yml.bak_2026-05-02_185546 docker-compose.yml
docker compose up -d
```

用户、余额、Key、渠道配置不应丢失，因为 MySQL 数据目录没有动：

```text
/www/dk_project/dk_app/newapi/newapi_SAz7/mysql_data
```

只要不删除这个目录、不执行 `docker compose down -v`，数据一般不会丢。

---

## 11. 禁止执行的危险命令

不要执行：

```bash
docker compose down -v
```

不要执行：

```bash
docker volume prune
```

不要执行：

```bash
rm -rf /www/dk_project/dk_app/newapi/newapi_SAz7/mysql_data
```

不要删除：

```text
/www/dk_project/dk_app/newapi/newapi_SAz7/mysql_data
```

---

## 12. 后续产品建议

后续最好不要给客户 New API 原生后台账号。

New API 后台偏管理员视角，可能还会暴露：

```text
渠道
倍率
错误详情
实际上游信息
other 字段
调试信息
```

更稳的做法是单独做客户用量/账单页，只展示：

```text
请求模型
请求次数
输入 token
输出 token
费用
余额
时间范围
```

不要展示：

```text
实际模型
渠道
倍率
other 字段
上游错误
调试信息
```

---

## 13. 一句话总结

本次目标不是迁移数据库，也不是重装 New API，而是：

**基于当前运行的 `calciumion/new-api` 源码构建一个自定义镜像，只修改普通用户日志脱敏逻辑，让普通用户看不到 `upstream_model_name` 和真实模型名，同时保留原有 MySQL 数据、用户、余额、Key 和渠道配置。**
