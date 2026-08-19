import React, { useEffect, useMemo, useState } from 'react';
import {
  Button,
  Card,
  DatePicker,
  Form,
  Input,
  Modal,
  Popconfirm,
  Select,
  Space,
  Table,
  Tabs,
  Tag,
  Typography,
  Upload,
  message,
} from 'antd';
import {
  DeleteOutlined,
  EditOutlined,
  FileAddOutlined,
  PlusOutlined,
  ReloadOutlined,
  UploadOutlined,
} from '@ant-design/icons';
import axios from 'axios';
import PageHeader from '../components/PageHeader';
import tagColor from '../utils/tagColor';
import dayjs from 'dayjs';
import { PERMISSIONS, hasPermission } from '../utils/permissions';

const { Text } = Typography;

const visibilityOptions = [
  { label: '公开', value: 'public' },
  { label: '专业/部门', value: 'department' },
  { label: '科室', value: 'section' },
  { label: '私有', value: 'private' },
];

const formatDate = (value) => (value ? dayjs(value).format('YYYY-MM-DD') : '-');
const tagsToText = (tags = []) => (Array.isArray(tags) ? tags.join(', ') : String(tags || ''));
const textToTags = (value) => String(value || '')
  .split(',')
  .map((tag) => tag.trim())
  .filter(Boolean);

const pickFile = (fileList) => {
  const item = fileList[0];
  return item?.originFileObj || item || null;
};

const ContentManagement = ({ currentUser }) => {
  const isPlatformAdmin = Boolean(currentUser?.isAdmin) && currentUser?.platformRole === 'super_admin';
  const [companies, setCompanies] = useState([]);
  const [selectedCompanyId, setSelectedCompanyId] = useState(currentUser?.companyId || null);
  const [catalog, setCatalog] = useState([]);
  const [documents, setDocuments] = useState([]);
  const [knowledgePoints, setKnowledgePoints] = useState([]);
  const [docPagination, setDocPagination] = useState({ current: 1, pageSize: 10, total: 0 });
  const [pointPagination, setPointPagination] = useState({ current: 1, pageSize: 10, total: 0 });
  const [docSearch, setDocSearch] = useState('');
  const [pointSearch, setPointSearch] = useState('');
  const [loadingDocs, setLoadingDocs] = useState(false);
  const [loadingPoints, setLoadingPoints] = useState(false);
  const [saving, setSaving] = useState(false);
  const [docCreateOpen, setDocCreateOpen] = useState(false);
  const [docEditOpen, setDocEditOpen] = useState(false);
  const [versionOpen, setVersionOpen] = useState(false);
  const [pointOpen, setPointOpen] = useState(false);
  const [editingDocument, setEditingDocument] = useState(null);
  const [versionDocument, setVersionDocument] = useState(null);
  const [editingPoint, setEditingPoint] = useState(null);
  const [docFileList, setDocFileList] = useState([]);
  const [versionFileList, setVersionFileList] = useState([]);
  const [docCreateForm] = Form.useForm();
  const [docEditForm] = Form.useForm();
  const [versionForm] = Form.useForm();
  const [pointForm] = Form.useForm();

  const canCreateFile = hasPermission(currentUser, PERMISSIONS.FILE_CREATE);
  const canUpdateFile = hasPermission(currentUser, PERMISSIONS.FILE_UPDATE);
  const canDeleteFile = hasPermission(currentUser, PERMISSIONS.FILE_DELETE);
  const canCreateFolder = hasPermission(currentUser, PERMISSIONS.FOLDER_CREATE);
  const canUpdateFolder = hasPermission(currentUser, PERMISSIONS.FOLDER_UPDATE);
  const canDeleteFolder = hasPermission(currentUser, PERMISSIONS.FOLDER_DELETE);

  const professionOptions = useMemo(
    () => catalog.map((profession) => ({ label: profession.name, value: profession.id })),
    [catalog]
  );

  const sectionOptions = useMemo(
    () => catalog.flatMap((profession) => (profession.sections || []).map((section) => ({
      label: `${profession.name} / ${section.name}`,
      value: section.id,
      professionId: profession.id,
      sectionName: section.name,
      professionName: profession.name,
    }))),
    [catalog]
  );

  const findProfessionId = (name) => professionOptions.find((item) => item.label === name)?.value;
  const findSectionId = (name) => sectionOptions.find((item) => item.sectionName === name)?.value;
  const requestParams = useMemo(
    () => (isPlatformAdmin && selectedCompanyId ? { companyId: selectedCompanyId } : {}),
    [isPlatformAdmin, selectedCompanyId]
  );

  const fetchCompanies = async () => {
    if (!isPlatformAdmin) return;
    try {
      const res = await axios.get('/api/companies');
      const list = res.data.companies || [];
      setCompanies(list);
      setSelectedCompanyId((current) => current || list[0]?.id || null);
    } catch (err) {
      message.error(err.response?.data?.message || '获取公司列表失败');
    }
  };

  const fetchCatalog = async () => {
    if (isPlatformAdmin && !selectedCompanyId) return;
    try {
      const res = await axios.get('/api/departments/professions', { params: requestParams });
      setCatalog(Array.isArray(res.data) ? res.data : []);
    } catch (err) {
      message.error(err.response?.data?.message || '获取专业目录失败');
    }
  };

  const fetchDocuments = async (page = docPagination.current, pageSize = docPagination.pageSize) => {
    if (isPlatformAdmin && !selectedCompanyId) return;
    try {
      setLoadingDocs(true);
      const res = await axios.get('/api/library-documents', {
        params: {
          page,
          limit: pageSize,
          search: docSearch || undefined,
          sortBy: 'updatedAt',
          sortOrder: 'desc',
          ...requestParams,
        },
      });
      setDocuments(res.data.documents || []);
      setDocPagination({
        current: res.data.pagination?.current || page,
        pageSize,
        total: res.data.pagination?.total || 0,
      });
    } catch (err) {
      message.error(err.response?.data?.message || '获取资料文件失败');
    } finally {
      setLoadingDocs(false);
    }
  };

  const fetchKnowledgePoints = async (page = pointPagination.current, pageSize = pointPagination.pageSize) => {
    if (isPlatformAdmin && !selectedCompanyId) return;
    try {
      setLoadingPoints(true);
      const res = await axios.get('/api/knowledge-points', {
        params: {
          page,
          limit: pageSize,
          search: pointSearch || undefined,
          sortBy: 'updatedAt',
          sortOrder: 'desc',
          ...requestParams,
        },
      });
      setKnowledgePoints(res.data.knowledgePoints || []);
      setPointPagination({
        current: res.data.pagination?.current || page,
        pageSize,
        total: res.data.pagination?.total || 0,
      });
    } catch (err) {
      message.error(err.response?.data?.message || '获取知识点失败');
    } finally {
      setLoadingPoints(false);
    }
  };

  useEffect(() => {
    fetchCompanies();
  }, [isPlatformAdmin]);

  useEffect(() => {
    fetchCatalog();
  }, [selectedCompanyId]);

  useEffect(() => {
    fetchDocuments(1, docPagination.pageSize);
  }, [docSearch, selectedCompanyId]);

  useEffect(() => {
    fetchKnowledgePoints(1, pointPagination.pageSize);
  }, [pointSearch, selectedCompanyId]);

  const openDocCreate = () => {
    setDocFileList([]);
    docCreateForm.resetFields();
    docCreateForm.setFieldsValue({ visibility: currentUser?.isAdmin ? 'public' : 'department', versionLabel: 'V1' });
    setDocCreateOpen(true);
  };

  const openDocEdit = (document) => {
    setEditingDocument(document);
    docEditForm.setFieldsValue({
      title: document.title,
      summary: document.summary,
      category: document.category,
      professionId: findProfessionId(document.profession),
      departmentId: findSectionId(document.section),
      visibility: document.visibility,
      tags: tagsToText(document.tags),
      effectiveDate: document.effectiveDate ? dayjs(document.effectiveDate) : null,
      reviewDate: document.reviewDate ? dayjs(document.reviewDate) : null,
      issuer: document.issuer,
      approver: document.approver,
      icon: document.icon,
      color: document.color,
    });
    setDocEditOpen(true);
  };

  const openVersion = (document) => {
    setVersionDocument(document);
    setVersionFileList([]);
    versionForm.resetFields();
    versionForm.setFieldsValue({ versionLabel: `V${Number(document.versionNumber || 1) + 1}` });
    setVersionOpen(true);
  };

  const buildDocumentPayload = (values) => ({
    title: values.title,
    summary: values.summary,
    category: values.category,
    professionId: values.professionId,
    departmentId: values.departmentId,
    visibility: values.visibility,
    tags: textToTags(values.tags),
    effectiveDate: values.effectiveDate ? values.effectiveDate.format('YYYY-MM-DD') : undefined,
    reviewDate: values.reviewDate ? values.reviewDate.format('YYYY-MM-DD') : undefined,
    issuer: values.issuer,
    approver: values.approver,
    icon: values.icon,
    color: values.color,
    ...requestParams,
  });

  const handleCreateDocument = async (values) => {
    const file = pickFile(docFileList);
    if (!file) {
      message.error('请选择资料文件');
      return;
    }

    try {
      setSaving(true);
      const formData = new FormData();
      Object.entries({ ...buildDocumentPayload(values), versionLabel: values.versionLabel || 'V1' })
        .forEach(([key, value]) => {
          if (value !== undefined && value !== null) {
            formData.append(key, Array.isArray(value) ? value.join(',') : value);
          }
        });
      formData.append('file', file);
      await axios.post('/api/library-documents', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      message.success('资料已上传');
      setDocCreateOpen(false);
      fetchDocuments(1, docPagination.pageSize);
    } catch (err) {
      message.error(err.response?.data?.message || '上传资料失败');
    } finally {
      setSaving(false);
    }
  };

  const handleUpdateDocument = async (values) => {
    try {
      setSaving(true);
      await axios.put(`/api/library-documents/${editingDocument.id}`, buildDocumentPayload(values));
      message.success('资料已更新');
      setDocEditOpen(false);
      fetchDocuments(docPagination.current, docPagination.pageSize);
    } catch (err) {
      message.error(err.response?.data?.message || '更新资料失败');
    } finally {
      setSaving(false);
    }
  };

  const handleUploadVersion = async (values) => {
    const file = pickFile(versionFileList);
    if (!file) {
      message.error('请选择新版本文件');
      return;
    }

    try {
      setSaving(true);
      const formData = new FormData();
      formData.append('file', file);
      formData.append('versionLabel', values.versionLabel);
      formData.append('changeLog', values.changeLog || '');
      await axios.post(`/api/library-documents/${versionDocument.id}/versions`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      message.success('新版本已发布');
      setVersionOpen(false);
      fetchDocuments(docPagination.current, docPagination.pageSize);
    } catch (err) {
      message.error(err.response?.data?.message || '发布新版本失败');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteDocument = async (document) => {
    try {
      await axios.delete(`/api/library-documents/${document.id}`);
      message.success('资料已删除');
      fetchDocuments(docPagination.current, docPagination.pageSize);
    } catch (err) {
      message.error(err.response?.data?.message || '删除资料失败');
    }
  };

  const openPointCreate = () => {
    setEditingPoint(null);
    pointForm.resetFields();
    pointForm.setFieldsValue({ visibility: 'department', icon: 'book-open-variant' });
    setPointOpen(true);
  };

  const openPointEdit = (point) => {
    setEditingPoint(point);
    pointForm.setFieldsValue({
      name: point.name,
      description: point.description,
      category: point.category,
      professionId: point.profession?.id,
      departmentId: point.department?.id,
      visibility: point.visibility,
      tags: tagsToText(point.tags),
      icon: point.icon,
    });
    setPointOpen(true);
  };

  const handleSavePoint = async (values) => {
    const payload = {
      name: values.name,
      description: values.description,
      category: values.category,
      professionId: values.professionId,
      departmentId: values.departmentId,
      visibility: values.visibility,
      tags: textToTags(values.tags),
      icon: values.icon,
      ...requestParams,
    };

    try {
      setSaving(true);
      if (editingPoint) {
        await axios.put(`/api/knowledge-points/${editingPoint.id}`, payload);
        message.success('知识点已更新');
      } else {
        await axios.post('/api/knowledge-points', payload);
        message.success('知识点已创建');
      }
      setPointOpen(false);
      fetchKnowledgePoints(pointPagination.current, pointPagination.pageSize);
    } catch (err) {
      message.error(err.response?.data?.message || '保存知识点失败');
    } finally {
      setSaving(false);
    }
  };

  const handleDeletePoint = async (point) => {
    try {
      await axios.delete(`/api/knowledge-points/${point.id}`);
      message.success('知识点已删除');
      fetchKnowledgePoints(pointPagination.current, pointPagination.pageSize);
    } catch (err) {
      message.error(err.response?.data?.message || '删除知识点失败');
    }
  };

  const documentColumns = [
    {
      title: '资料',
      dataIndex: 'title',
      key: 'title',
      render: (title, record) => (
        <Space direction="vertical" size={0}>
          <Text strong>{title}</Text>
          <Text type="secondary">{record.profession || '未归属专业'} / {record.section || '未归属科室'}</Text>
        </Space>
      ),
    },
    {
      title: '类型',
      dataIndex: 'category',
      key: 'category',
      width: 120,
      render: (value) => <Tag color={tagColor(value)}>{value || '资料'}</Tag>,
    },
    {
      title: '版本',
      dataIndex: 'version',
      key: 'version',
      width: 100,
    },
    {
      title: '复审',
      dataIndex: 'reviewDate',
      key: 'reviewDate',
      width: 120,
      render: formatDate,
    },
    {
      title: '访问',
      key: 'traffic',
      width: 120,
      render: (_, record) => `${record.viewCount || 0} / ${record.downloadCount || 0}`,
    },
    {
      title: '权限',
      dataIndex: 'canManage',
      key: 'canManage',
      width: 90,
      render: (value) => <Tag color={value ? 'green' : 'default'}>{value ? '可管理' : '只读'}</Tag>,
    },
    {
      title: '更新',
      dataIndex: 'updatedAt',
      key: 'updatedAt',
      width: 120,
      render: formatDate,
    },
    (canUpdateFile || canDeleteFile) && {
      title: '操作',
      key: 'action',
      width: 210,
      render: (_, record) => (
        <Space>
          {canUpdateFile && record.canUpdate ? (
            <Button type="link" icon={<EditOutlined />} onClick={() => openDocEdit(record)}>编辑</Button>
          ) : null}
          {canUpdateFile && record.canUploadVersion ? (
            <Button type="link" icon={<UploadOutlined />} onClick={() => openVersion(record)}>版本</Button>
          ) : null}
          {canDeleteFile && record.canDelete ? (
            <Popconfirm title="删除资料" description="删除后将无法恢复，确认删除该资料？" onConfirm={() => handleDeleteDocument(record)}>
              <Button type="link" danger icon={<DeleteOutlined />}>删除</Button>
            </Popconfirm>
          ) : null}
        </Space>
      ),
    },
  ].filter(Boolean);

  const pointColumns = [
    {
      title: '知识点',
      dataIndex: 'name',
      key: 'name',
      render: (name, record) => (
        <Space direction="vertical" size={0}>
          <Text strong>{name}</Text>
          <Text type="secondary">{record.description || '未填写描述'}</Text>
        </Space>
      ),
    },
    {
      title: '归属',
      key: 'scope',
      width: 220,
      render: (_, record) => `${record.profession?.name || '未归属专业'} / ${record.department?.name || '未归属科室'}`,
    },
    {
      title: '分类',
      dataIndex: 'category',
      key: 'category',
      width: 120,
      render: (value) => value ? <Tag>{value}</Tag> : '-',
    },
    {
      title: '文件',
      dataIndex: 'fileCount',
      key: 'fileCount',
      width: 80,
    },
    {
      title: '可见性',
      dataIndex: 'visibility',
      key: 'visibility',
      width: 100,
    },
    (canUpdateFolder || canDeleteFolder) && {
      title: '操作',
      key: 'action',
      width: 150,
      render: (_, record) => (
        <Space>
          {canUpdateFolder ? <Button type="link" icon={<EditOutlined />} onClick={() => openPointEdit(record)}>编辑</Button> : null}
          {canDeleteFolder ? (
            <Popconfirm title="删除知识点" description="删除后将无法恢复，确认删除该知识点？" onConfirm={() => handleDeletePoint(record)}>
              <Button type="link" danger icon={<DeleteOutlined />}>删除</Button>
            </Popconfirm>
          ) : null}
        </Space>
      ),
    },
  ].filter(Boolean);

  const documentForm = (form, includeFile = false) => (
    <Form form={form} layout="vertical" onFinish={includeFile ? handleCreateDocument : handleUpdateDocument}>
      {includeFile ? (
        <Form.Item label="资料文件" required>
          <Upload
            fileList={docFileList}
            beforeUpload={() => false}
            onChange={({ fileList }) => setDocFileList(fileList.slice(-1))}
            onRemove={() => setDocFileList([])}
          >
            <Button icon={<FileAddOutlined />}>选择文件</Button>
          </Upload>
        </Form.Item>
      ) : null}
      <Form.Item name="title" label="资料名称" rules={[{ required: true, message: '请输入资料名称' }]}>
        <Input />
      </Form.Item>
      <Form.Item name="summary" label="摘要">
        <Input.TextArea rows={3} />
      </Form.Item>
      <Space style={{ width: '100%' }} size={12} align="start">
        <Form.Item name="professionId" label="专业" style={{ width: 220 }}>
          <Select options={professionOptions} showSearch optionFilterProp="label" />
        </Form.Item>
        <Form.Item name="departmentId" label="科室" style={{ width: 260 }}>
          <Select options={sectionOptions} showSearch optionFilterProp="label" />
        </Form.Item>
      </Space>
      <Space style={{ width: '100%' }} size={12} align="start">
        <Form.Item name="category" label="类型" style={{ width: 180 }}>
          <Input placeholder="操作流程 / 措施模板" />
        </Form.Item>
        <Form.Item name="visibility" label="可见性" style={{ width: 160 }} rules={[{ required: true, message: '请选择可见性' }]}>
          <Select options={visibilityOptions.filter((item) => currentUser?.isAdmin || item.value !== 'public')} />
        </Form.Item>
        {includeFile ? (
          <Form.Item name="versionLabel" label="版本" style={{ width: 120 }}>
            <Input />
          </Form.Item>
        ) : null}
      </Space>
      <Space style={{ width: '100%' }} size={12} align="start">
        <Form.Item name="effectiveDate" label="生效日期">
          <DatePicker />
        </Form.Item>
        <Form.Item name="reviewDate" label="复审日期">
          <DatePicker />
        </Form.Item>
      </Space>
      <Space style={{ width: '100%' }} size={12} align="start">
        <Form.Item name="issuer" label="发布单位" style={{ width: 220 }}>
          <Input />
        </Form.Item>
        <Form.Item name="approver" label="批准人" style={{ width: 220 }}>
          <Input />
        </Form.Item>
      </Space>
      <Form.Item name="tags" label="标签">
        <Input placeholder="多个标签用英文逗号分隔" />
      </Form.Item>
      <Space style={{ width: '100%' }} size={12} align="start">
        <Form.Item name="icon" label="图标" style={{ width: 220 }}>
          <Input placeholder="file-document-outline" />
        </Form.Item>
        <Form.Item name="color" label="颜色" style={{ width: 140 }}>
          <Input placeholder="#1F6F8B" />
        </Form.Item>
      </Space>
    </Form>
  );

  return (
    <div>
      <PageHeader
        title="资料内容管理"
        extra={isPlatformAdmin ? (
          <Select
            style={{ width: 220 }}
            value={selectedCompanyId}
            options={companies.map((company) => ({ label: company.name, value: company.id }))}
            onChange={setSelectedCompanyId}
            placeholder="选择公司"
            showSearch
            optionFilterProp="label"
          />
        ) : null}
      />
      <Card>
      <Tabs
        items={[
          {
            key: 'documents',
            label: '资料',
            children: (
              <>
                <Space style={{ marginBottom: 16, width: '100%', justifyContent: 'space-between' }}>
                  <Input.Search
                    placeholder="搜索资料名称、科室、标签"
                    allowClear
                    onSearch={setDocSearch}
                    style={{ width: 320 }}
                  />
                  <Space>
                    <Button icon={<ReloadOutlined />} onClick={() => fetchDocuments()} loading={loadingDocs}>刷新</Button>
                    {canCreateFile ? <Button type="primary" icon={<PlusOutlined />} onClick={openDocCreate}>上传资料</Button> : null}
                  </Space>
                </Space>
                <Table
                  columns={documentColumns}
                  dataSource={documents}
                  rowKey="id"
                  loading={loadingDocs}
                  pagination={docPagination}
                  onChange={(pagination) => fetchDocuments(pagination.current, pagination.pageSize)}
                />
              </>
            ),
          },
          {
            key: 'points',
            label: '知识点',
            children: (
              <>
                <Space style={{ marginBottom: 16, width: '100%', justifyContent: 'space-between' }}>
                  <Input.Search
                    placeholder="搜索知识点名称、分类"
                    allowClear
                    onSearch={setPointSearch}
                    style={{ width: 320 }}
                  />
                  <Space>
                    <Button icon={<ReloadOutlined />} onClick={() => fetchKnowledgePoints()} loading={loadingPoints}>刷新</Button>
                    {canCreateFolder ? <Button type="primary" icon={<PlusOutlined />} onClick={openPointCreate}>新建知识点</Button> : null}
                  </Space>
                </Space>
                <Table
                  columns={pointColumns}
                  dataSource={knowledgePoints}
                  rowKey="id"
                  loading={loadingPoints}
                  pagination={pointPagination}
                  onChange={(pagination) => fetchKnowledgePoints(pagination.current, pagination.pageSize)}
                />
              </>
            ),
          },
        ]}
      />

      <Modal
        title="上传资料"
        open={docCreateOpen}
        onOk={() => docCreateForm.submit()}
        onCancel={() => setDocCreateOpen(false)}
        confirmLoading={saving}
        okText="上传"
        cancelText="取消"
        width={760}
      >
        {documentForm(docCreateForm, true)}
      </Modal>

      <Modal
        title="编辑资料"
        open={docEditOpen}
        onOk={() => docEditForm.submit()}
        onCancel={() => setDocEditOpen(false)}
        confirmLoading={saving}
        okText="保存"
        cancelText="取消"
        width={760}
      >
        {documentForm(docEditForm)}
      </Modal>

      <Modal
        title="发布新版本"
        open={versionOpen}
        onOk={() => versionForm.submit()}
        onCancel={() => setVersionOpen(false)}
        confirmLoading={saving}
        okText="发布"
        cancelText="取消"
      >
        <Form form={versionForm} layout="vertical" onFinish={handleUploadVersion}>
          <Form.Item label="版本文件" required>
            <Upload
              fileList={versionFileList}
              beforeUpload={() => false}
              onChange={({ fileList }) => setVersionFileList(fileList.slice(-1))}
              onRemove={() => setVersionFileList([])}
            >
              <Button icon={<UploadOutlined />}>选择文件</Button>
            </Upload>
          </Form.Item>
          <Form.Item name="versionLabel" label="版本号" rules={[{ required: true, message: '请输入版本号' }]}>
            <Input placeholder="V2" />
          </Form.Item>
          <Form.Item name="changeLog" label="变更说明">
            <Input.TextArea rows={3} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={editingPoint ? '编辑知识点' : '新建知识点'}
        open={pointOpen}
        onOk={() => pointForm.submit()}
        onCancel={() => setPointOpen(false)}
        confirmLoading={saving}
        okText="保存"
        cancelText="取消"
        width={680}
      >
        <Form form={pointForm} layout="vertical" onFinish={handleSavePoint}>
          <Form.Item name="name" label="名称" rules={[{ required: true, message: '请输入知识点名称' }]}>
            <Input />
          </Form.Item>
          <Form.Item name="description" label="描述">
            <Input.TextArea rows={3} />
          </Form.Item>
          <Space style={{ width: '100%' }} size={12} align="start">
            <Form.Item name="professionId" label="专业" style={{ width: 220 }}>
              <Select options={professionOptions} showSearch optionFilterProp="label" />
            </Form.Item>
            <Form.Item name="departmentId" label="科室" style={{ width: 260 }}>
              <Select options={sectionOptions} showSearch optionFilterProp="label" />
            </Form.Item>
          </Space>
          <Space style={{ width: '100%' }} size={12} align="start">
            <Form.Item name="category" label="分类" style={{ width: 220 }}>
              <Input />
            </Form.Item>
            <Form.Item name="visibility" label="可见性" style={{ width: 160 }}>
              <Select options={visibilityOptions.filter((item) => currentUser?.isAdmin || item.value !== 'public')} />
            </Form.Item>
          </Space>
          <Form.Item name="tags" label="标签">
            <Input placeholder="多个标签用英文逗号分隔" />
          </Form.Item>
          <Form.Item name="icon" label="图标">
            <Input placeholder="book-open-variant" />
          </Form.Item>
        </Form>
      </Modal>
      </Card>
    </div>
  );
};

export default ContentManagement;
